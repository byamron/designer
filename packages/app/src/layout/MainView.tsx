import { useMemo } from "react";
import { selectTab, useAppState } from "../store/app";
import { refreshWorkspaces, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";
import type { Tab, TabTemplate, Workspace } from "../ipc/types";
import { HomeTab } from "../home/HomeTab";
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
  const projects = useDataState((s) => s.projects);
  const workspaces = useDataState((s) => s.workspaces);

  const workspace: Workspace | null = useMemo(() => {
    if (!activeProjectId || !activeWorkspaceId) return null;
    const group: WorkspaceSummary[] =
      workspaces[activeProjectId] ?? emptyArray();
    return group.find((w) => w.workspace.id === activeWorkspaceId)?.workspace ?? null;
  }, [activeProjectId, activeWorkspaceId, workspaces]);

  if (!workspace) {
    return (
      <main className="app-main" aria-label="Main" id="main-content" tabIndex={-1}>
        <div
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-muted)",
            textAlign: "center",
            padding: "var(--space-5)",
          }}
        >
          <div
            style={{
              maxWidth: "calc(var(--space-8) * 6)",
              display: "flex",
              flexDirection: "column",
              gap: "var(--space-3)",
            }}
          >
            <h2 style={{ fontSize: "var(--type-h2-size)", margin: 0, color: "var(--color-foreground)" }}>
              Pick a workspace
            </h2>
            <p style={{ margin: 0 }}>
              A workspace is a feature or initiative — a team of agents working on one
              thing. Select one from the sidebar or create a new one.
            </p>
          </div>
        </div>
      </main>
    );
  }

  const activeTab = activeTabByWorkspace[workspace.id] ?? "home";
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
        <div>
          <h1 className="main-topbar__title">{workspace.name}</h1>
          <div className="main-topbar__meta">
            {projectName} · {workspace.base_branch} ·{" "}
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "var(--space-1)",
              }}
            >
              <span className="state-dot" data-state={workspace.state} aria-hidden="true" />
              {workspace.state}
            </span>
          </div>
        </div>
        <div className="main-topbar__spacer" />
        <TemplateMenu onOpen={onOpenTab} />
      </div>

      <div className="tabs-bar" role="tablist" aria-orientation="horizontal">
        <TabButton
          workspaceId={workspace.id}
          id="home"
          label="Home"
          template="plan"
          active={activeTab === "home"}
          kicker="overview"
        />
        {workspace.tabs
          .filter((t) => !t.closed_at)
          .map((tab) => (
            <TabButton
              key={tab.id}
              workspaceId={workspace.id}
              id={tab.id}
              label={tab.title}
              template={tab.template}
              active={activeTab === tab.id}
              kicker={tab.template}
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
        <div className="tab-body__inner">
          {activeTab === "home" ? (
            <HomeTab workspace={workspace} />
          ) : (
            <TabContent
              tab={workspace.tabs.find((t) => t.id === activeTab)!}
              workspace={workspace}
            />
          )}
        </div>
      </section>
    </main>
  );
}

function TabButton({
  id,
  workspaceId,
  label,
  template,
  active,
  kicker,
}: {
  id: Tab["id"] | "home";
  workspaceId: string;
  label: string;
  template: TabTemplate;
  active: boolean;
  kicker: string;
}) {
  return (
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
      onKeyDown={(e) => {
        if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
          e.preventDefault();
          const parent = (e.currentTarget.parentElement as HTMLElement) || null;
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
        }
      }}
    >
      <span>{label}</span>
      <span className="tab-button__template">{kicker}</span>
    </button>
  );
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
  return (
    <div role="group" aria-label="New tab" style={{ display: "flex", gap: "var(--space-1)" }}>
      <button type="button" className="btn" onClick={() => onOpen("plan")}>
        + Plan
      </button>
      <button type="button" className="btn" onClick={() => onOpen("design")}>
        + Design
      </button>
      <button type="button" className="btn" onClick={() => onOpen("build")}>
        + Build
      </button>
      <button type="button" className="btn" onClick={() => onOpen("blank")}>
        + Blank
      </button>
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
