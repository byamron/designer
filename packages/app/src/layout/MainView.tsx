import { useEffect, useMemo, useRef, useState } from "react";
import { selectTab, setDashboardVariant, useAppState } from "../store/app";
import type { DashboardVariant } from "../store/app";
import { refreshWorkspaces, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";
import type { Project, Tab, TabTemplate, Workspace } from "../ipc/types";
import { HomeTabA } from "../home/HomeTabA";
import { HomeTabB } from "../home/HomeTabB";
import { PlanTab } from "../tabs/PlanTab";
import { DesignTab } from "../tabs/DesignTab";
import { BuildTab } from "../tabs/BuildTab";
import { BlankTab } from "../tabs/BlankTab";
import { emptyArray } from "../util/empty";
import type { WorkspaceSummary } from "../ipc/types";

export function MainView() {
  const activeWorkspaceId = useAppState((s) => s.activeWorkspace);
  const activeProjectId = useAppState((s) => s.activeProject);
  const activeTabByWorkspace = useAppState((s) => s.activeTabByWorkspace);
  const dashboardVariant = useAppState((s) => s.dashboardVariant);
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
        <div className="main-empty">
          <h2 className="main-empty__title">Pick a project</h2>
          <p className="main-empty__body">
            Select a project from the sidebar to see its home.
          </p>
        </div>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="app-main" aria-label="Main" id="main-content" tabIndex={-1}>
        <div className="main-topbar">
          <div className="main-topbar__heading">
            <h1 className="main-topbar__title">{project.name}</h1>
            <span className="main-topbar__meta">{project.root_path}</span>
          </div>
          <div className="main-topbar__actions">
            <VariantToggle value={dashboardVariant} onChange={setDashboardVariant} />
          </div>
        </div>

        <section
          className="tab-body"
          role="region"
          id="project-home"
          aria-label={`${project.name} home`}
          tabIndex={0}
        >
          {dashboardVariant === "B" ? (
            <HomeTabB project={project} />
          ) : (
            <HomeTabA project={project} />
          )}
        </section>
      </main>
    );
  }

  const visibleTabs = workspace.tabs.filter((t) => !t.closed_at);
  const storedTab = activeTabByWorkspace[workspace.id];
  const activeTab =
    storedTab && storedTab !== "home" && visibleTabs.some((t) => t.id === storedTab)
      ? storedTab
      : visibleTabs[0]?.id ?? null;

  const projectName =
    projects.find((p) => p.project.id === workspace.project_id)?.project.name ?? "";

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
      <div className="main-topbar">
        <div className="main-topbar__heading">
          <span className="state-dot" data-state={workspace.state} aria-hidden="true" />
          <h1 className="main-topbar__title">{workspace.name}</h1>
          <span className="main-topbar__sep" aria-hidden="true">/</span>
          <span className="main-topbar__project">{projectName}</span>
          <span className="main-topbar__branch" title={`branch ${workspace.base_branch}`}>
            <IconBranch />
            <span>{workspace.base_branch}</span>
          </span>
        </div>
        <div className="main-topbar__actions">
          <TemplateMenu onOpen={onOpenTab} />
        </div>
      </div>

      {visibleTabs.length > 0 && activeTab !== null ? (
        <>
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
          </div>

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
        </>
      ) : (
        <section className="tab-body" role="region" tabIndex={0}>
          <div className="main-empty">
            <h2 className="main-empty__title">No tabs yet</h2>
            <p className="main-empty__body">
              Open a Plan, Design, Build, or Blank tab from the top bar.
            </p>
          </div>
        </section>
      )}
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
        title={`${label} · ${template}${onClose ? " · ⌘W to close" : ""}`}
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
      {onClose && (
        <button
          type="button"
          className="tab-button__close"
          aria-label={`Close ${label}`}
          title={`Close ${label} (⌘W)`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M2 2l6 6" />
            <path d="M8 2l-6 6" />
          </svg>
        </button>
      )}
    </div>
  );
}

function IconBranch() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="3.5" cy="2.5" r="1" />
      <circle cx="3.5" cy="9.5" r="1" />
      <circle cx="8.5" cy="6" r="1" />
      <path d="M3.5 3.5v5" />
      <path d="M3.5 6h4" />
    </svg>
  );
}

function TemplateIcon({ template }: { template: TabTemplate }) {
  switch (template) {
    case "plan":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
          <rect x="2.5" y="2.5" width="9" height="9" rx="1.25" />
          <path d="M4.5 5.5h5" />
          <path d="M4.5 8h3" />
        </svg>
      );
    case "design":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
          <circle cx="7" cy="7" r="4.5" />
          <path d="M4.5 4.5l5 5" />
        </svg>
      );
    case "build":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 7l3 3 5-6" />
        </svg>
      );
    case "blank":
      return (
        <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
          <rect x="2.5" y="2.5" width="9" height="9" rx="1.25" />
        </svg>
      );
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
      <button
        type="button"
        className="new-tab__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title="New tab (⌘T)"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
          <path d="M6 2v8" />
          <path d="M2 6h8" />
        </svg>
        <span>New tab</span>
        <kbd className="new-tab__kbd">⌘T</kbd>
      </button>
      {open && (
        <div role="menu" className="new-tab__menu" aria-label="New tab template">
          {(["plan", "design", "build", "blank"] as TabTemplate[]).map((t, i) => (
            <button
              key={t}
              ref={i === 0 ? firstItemRef : undefined}
              role="menuitem"
              type="button"
              className="new-tab__item"
              title={descriptionForTemplate(t)}
              onClick={() => pick(t)}
            >
              <span className="new-tab__item-icon" aria-hidden="true">
                <TemplateIcon template={t} />
              </span>
              <span>{titleForTemplate(t)}</span>
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
      return "New tab";
  }
}

function descriptionForTemplate(template: TabTemplate): string {
  switch (template) {
    case "plan":
      return "Chat with the team lead to scope the work";
    case "design":
      return "Prototype browser + component catalog";
    case "build":
      return "Task list + merge-approval gate";
    case "blank":
      return "Empty canvas with prompt suggestions";
  }
}

function VariantToggle({
  value,
  onChange,
}: {
  value: DashboardVariant;
  onChange: (v: DashboardVariant) => void;
}) {
  return (
    <div
      className="variant-toggle"
      role="group"
      aria-label="Home variant"
      title="Switch home layout"
    >
      <button
        type="button"
        className="variant-toggle__btn"
        aria-pressed={value === "A"}
        title="Panels — dashboard with titled sections"
        onClick={() => onChange("A")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" aria-hidden="true">
          <rect x="1.5" y="1.5" width="9" height="4" rx="1" />
          <rect x="1.5" y="6.5" width="9" height="4" rx="1" />
        </svg>
        <span>Panels</span>
      </button>
      <button
        type="button"
        className="variant-toggle__btn"
        aria-pressed={value === "B"}
        title="Palette — centered prompt + suggestions"
        onClick={() => onChange("B")}
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" aria-hidden="true">
          <rect x="1.5" y="3.5" width="9" height="2.5" rx="1.25" />
          <path d="M3 8.25h6" />
          <path d="M3 10h4" />
        </svg>
        <span>Palette</span>
      </button>
    </div>
  );
}
