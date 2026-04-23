import { useEffect, useMemo, useRef, useState } from "react";
import {
  ClipboardList,
  Compass,
  ListChecks,
  Square,
} from "lucide-react";
import { selectTab, useAppState } from "../store/app";
import { refreshWorkspaces, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";
import type { Project, Tab, TabTemplate, Workspace } from "../ipc/types";
import { HomeTabA } from "../home/HomeTabA";
import { PlanTab } from "../tabs/PlanTab";
import { DesignTab } from "../tabs/DesignTab";
import { BuildTab } from "../tabs/BuildTab";
import { BlankTab } from "../tabs/BlankTab";
import { emptyArray } from "../util/empty";
import type { WorkspaceSummary } from "../ipc/types";
import { Tooltip } from "../components/Tooltip";
import { IconButton } from "../components/IconButton";
import { IconX, IconPlus } from "../components/icons";

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
    return (
      <main className="app-main" aria-label="Main" id="main-content" tabIndex={-1}>
        <div className="main-surface">
          <div className="main-empty">
            <h2 className="main-empty__title">Pick a project</h2>
            <p className="main-empty__body">
              Select a project from the sidebar to see its home.
            </p>
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

  const onOpenTab = async (template: TabTemplate) => {
    const tab = await ipcClient().openTab({
      workspace_id: workspace.id,
      title: titleForTemplate(template),
      template,
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
        {visibleTabs.map((tab) => (
          <TabButton
            key={tab.id}
            workspaceId={workspace.id}
            id={tab.id}
            label={tab.title}
            template={tab.template}
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
        <TemplateMenu onOpen={onOpenTab} />
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
            <TabContent
              key={`${workspace.id}:${activeTab}`}
              tab={visibleTabs.find((t) => t.id === activeTab)!}
              workspace={workspace}
            />
          </section>
        ) : (
          <section className="tab-body" role="region" tabIndex={0}>
            <div className="main-empty">
              <h2 className="main-empty__title">No tabs yet</h2>
              <p className="main-empty__body">
                Open a Plan, Design, Build, or Blank tab with the + button above.
              </p>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function TabButton({
  id,
  workspaceId,
  label,
  template,
  active,
  onClose,
}: {
  id: Tab["id"];
  workspaceId: string;
  label: string;
  template: TabTemplate;
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
          data-template={template}
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
          <span className="tab-button__icon" aria-hidden="true">
            <TemplateIcon template={template} />
          </span>
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
          <IconX size={10} />
        </button>
      )}
    </div>
  );
}

function TemplateIcon({ template }: { template: TabTemplate }) {
  const common = { size: 14, strokeWidth: 1.25, "aria-hidden": true as const };
  switch (template) {
    case "plan":
      return <ClipboardList {...common} />;
    case "design":
      return <Compass {...common} />;
    case "build":
      return <ListChecks {...common} />;
    case "blank":
      return <Square {...common} />;
  }
}

function TabContent({ tab, workspace }: { tab: Tab; workspace: Workspace }) {
  switch (tab.template) {
    case "plan":
      return <PlanTab tab={tab} workspace={workspace} />;
    case "design":
      return <DesignTab tab={tab} workspace={workspace} />;
    case "build":
      return <BuildTab tab={tab} workspace={workspace} />;
    case "blank":
      return <BlankTab tab={tab} workspace={workspace} />;
  }
}

/**
 * Trailing "+" inside the tabs-bar. Opens a small template menu anchored to
 * the button. Matches the visual weight of a collapsed tab so the strip
 * reads as a single row. ⌘T toggles; click-outside or Escape closes.
 */
function TemplateMenu({ onOpen }: { onOpen: (t: TabTemplate) => void }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const firstItemRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "t") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape" && open) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onClick);
    firstItemRef.current?.focus();
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  const pick = (t: TabTemplate) => {
    setOpen(false);
    onOpen(t);
  };

  return (
    <div className="new-tab" ref={wrapRef}>
      <IconButton
        label="New tab"
        shortcut="⌘T"
        pressed={open}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <IconPlus size={12} strokeWidth={1.5} />
      </IconButton>
      {open && (
        <div role="menu" className="new-tab__menu" aria-label="New tab template">
          {(["plan", "design", "build", "blank"] as TabTemplate[]).map((t, i) => (
            <button
              key={t}
              ref={i === 0 ? firstItemRef : undefined}
              role="menuitem"
              type="button"
              className="new-tab__item"
              onClick={() => pick(t)}
            >
              <span className="new-tab__item-icon" aria-hidden="true">
                <TemplateIcon template={t} />
              </span>
              <span>{titleForTemplate(t)}</span>
              <span className="new-tab__item-hint">{descriptionForTemplate(t)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function titleForTemplate(template: TabTemplate): string {
  switch (template) {
    case "plan":
      return "Plan";
    case "design":
      return "Design";
    case "build":
      return "Build";
    case "blank":
      return "Blank tab";
  }
}

function descriptionForTemplate(template: TabTemplate): string {
  switch (template) {
    case "plan":
      return "Chat with the team lead";
    case "design":
      return "Prototype + catalog";
    case "build":
      return "Tasks + approvals";
    case "blank":
      return "Empty canvas";
  }
}

