import { useEffect, useMemo, useRef, useState } from "react";
import {
  appStore,
  clearTabState,
  openCreateProject,
  selectTab,
  useAppState,
} from "../store/app";
import { activityKey, refreshWorkspaces, useDataState } from "../store/data";
import { ipcClient } from "../ipc/client";
import type {
  ActivityState,
  Project,
  Tab,
  TabId,
  Workspace,
} from "../ipc/types";
import { HomeTabA } from "../home/HomeTabA";
import { ArchivedView } from "../home/ArchivedView";
import { WorkspaceThread } from "../tabs/WorkspaceThread";
import { emptyArray } from "../util/empty";
import type { WorkspaceSummary } from "../ipc/types";
import { Tooltip } from "../components/Tooltip";
import { IconButton } from "../components/IconButton";
import { IconX, IconPlus } from "../components/icons";
import { CostChip } from "../components/CostChip";
import { RenameInput } from "../components/RenameInput";
import { RowContextMenu, type ContextMenuItem } from "../components/RowContextMenu";

export function MainView() {
  const activeWorkspaceId = useAppState((s) => s.activeWorkspace);
  const activeProjectId = useAppState((s) => s.activeProject);
  const activeView = useAppState((s) => s.activeView);
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

  // Hooks must run on every render — keep them above the early returns.
  // The handlers below close over `workspace`; when no workspace is
  // selected, the handler is a no-op that the chrome (the + button + ⌘T
  // listener) only mounts inside the workspace branch anyway.
  const openingRef = useRef(false);
  const [opening, setOpening] = useState(false);
  const openTabHandlerRef = useRef<() => Promise<void>>(async () => {});
  // Synchronous re-entry guard. React state updates are batched, so two
  // clicks within the same microtask both observe the prior state and
  // both fire `ipcClient.openTab` — producing duplicate tabs. The ref is
  // set synchronously so a burst click short-circuits before reaching
  // the IPC call. Mirrors `WorkspaceThread.sendingRef`. The `opening`
  // state mirror drives the visible disabled affordance on the + button.
  const onOpenTab = async () => {
    if (!workspace) return;
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    try {
      // Title uses the highest existing index + 1 so closing a middle tab
      // and opening a new one doesn't produce a duplicate "Tab N". See B10
      // — we count from the underlying titles, not visibleTabs.length.
      const tab = await ipcClient().openTab({
        workspace_id: workspace.id,
        title: nextTabTitle(workspace.tabs),
        template: "thread",
      });
      if (workspace.project_id) {
        await refreshWorkspaces(workspace.project_id);
      }
      selectTab(workspace.id, tab.id);
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  };
  openTabHandlerRef.current = onOpenTab;

  // ⌘T global shortcut. The tooltip on the + button has advertised this
  // since 13.0; it just wasn't wired. Skips when focus is in a text input
  // so the user can still type a "t" anywhere a textbox is mounted. The
  // handler ref keeps the closure fresh without re-registering the
  // listener on every render.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "t") return;
      if (e.shiftKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable) {
          return;
        }
      }
      e.preventDefault();
      void openTabHandlerRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!project) {
    // First-run (no projects) ships a primary CTA so the empty surface
    // doesn't read as a dead end. Once at least one project exists, fall
    // back to the "pick from sidebar" copy.
    const firstRun = projects.length === 0;
    return (
      <main className="app-main" data-component="MainView" aria-label="Main" id="main-content" tabIndex={-1}>
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
    const isArchived = activeView === "archived";
    return (
      <main className="app-main" data-component="MainView" aria-label="Main" id="main-content" tabIndex={-1}>
        {/* Project home / Archived — both surfaces render in the same
            slot since they're the project-level views the sidebar tabs
            switch between. The Palette variant is still used for blank
            tabs (BlankTab) where it better fits the "I don't know what
            I want yet; show me affordances" intent. */}
        <div className="main-surface">
          <section
            className="tab-body"
            role="region"
            id={isArchived ? "project-archived" : "project-home"}
            aria-label={`${project.name} ${isArchived ? "archived workspaces" : "home"}`}
            tabIndex={0}
          >
            {isArchived ? (
              <ArchivedView project={project} />
            ) : (
              <HomeTabA project={project} />
            )}
          </section>
        </div>
      </main>
    );
  }

  return (
    <WorkspaceMain
      workspace={workspace}
      activeTabByWorkspace={activeTabByWorkspace}
      opening={opening}
      onOpenTab={onOpenTab}
    />
  );
}

/** Workspace branch of MainView, lifted into its own component so the
 *  ⌘W and tab-close hooks can use refs/effects without violating Rules
 *  of Hooks across the no-project / no-workspace early returns above. */
function WorkspaceMain({
  workspace,
  activeTabByWorkspace,
  opening,
  onOpenTab,
}: {
  workspace: Workspace;
  activeTabByWorkspace: Record<string, TabId>;
  opening: boolean;
  onOpenTab: () => Promise<void>;
}) {
  const visibleTabs = workspace.tabs.filter((t) => !t.closed_at);
  const storedTab = activeTabByWorkspace[workspace.id];
  const activeTab =
    storedTab && storedTab !== "home" && visibleTabs.some((t) => t.id === storedTab)
      ? storedTab
      : visibleTabs[0]?.id ?? null;

  // Both the X button and the global ⌘W shortcut close through the same
  // helper so a click and a keystroke take the exact same path. Without
  // a shared closer the X button worked while ⌘W only fired when focus
  // was on the tab button itself — the close-tab friction report.
  const closeTab = async (tabId: TabId) => {
    // Workspace must always have at least one open tab — closing the only
    // tab is a UX dead-end that strands the user in an empty pane. The
    // backend enforces the same invariant (frc_019dea6b); guarding here
    // keeps the local-state cleanup (clearTabState, refresh, focus move)
    // from running on a no-op close.
    if (visibleTabs.length <= 1) return;
    const wasActive = activeTab === tabId;
    const remaining = visibleTabs.filter((t) => t.id !== tabId);
    await ipcClient().closeTab(workspace.id, tabId);
    // Reap per-tab UI state (composer draft, started flag) so the
    // store doesn't accumulate entries for closed tabs over a long
    // session. Same id never reopens — TabId is a v7 UUID — so no risk
    // of inadvertently restoring a stale draft on reopen.
    clearTabState(tabId);
    await refreshWorkspaces(workspace.project_id);
    if (wasActive && remaining[0]) {
      selectTab(workspace.id, remaining[0].id);
    }
    // B11 — closing a tab via the X button leaves focus on a node that
    // just unmounted; without an explicit move, the browser drops focus
    // to <body> and keyboard users lose their place. Send focus to the
    // next tab if there is one, otherwise to the new-tab button.
    requestAnimationFrame(() => {
      const next =
        document.querySelector<HTMLButtonElement>(
          `#tab-${workspace.id}-${remaining[0]?.id}`,
        ) ?? document.querySelector<HTMLButtonElement>(".new-tab button");
      next?.focus();
    });
  };
  const closeTabRef = useRef(closeTab);
  closeTabRef.current = closeTab;

  // Global ⌘W. Closes the currently active tab regardless of focus —
  // matches the in-tab keydown so a user typing in the composer
  // textarea can still close the tab without tabbing out first.
  // Skipped when any modal scrim is open (help / create-project
  // dialogs, quick switcher) so the keystroke can still dismiss
  // those layers via their own listeners (App.tsx ESC handler) and
  // doesn't reach through the overlay to silently close a tab.
  // Settings is a full-page takeover that unmounts MainView entirely,
  // so it doesn't need a guard here.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "w") return;
      if (e.shiftKey || e.altKey) return;
      const s = appStore.get();
      if (s.dialog !== null || s.quickSwitcherOpen) return;
      const id = activeTab;
      if (!id) return;
      e.preventDefault();
      void closeTabRef.current(id);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTab]);

  return (
    <main className="app-main" data-component="MainView" aria-label="Main" id="main-content" tabIndex={-1}>
      {/* Workspace chrome: the tabs bar is the top row. Workspace name,
          branch, and lifecycle state all live in the left sidebar already. */}
      <div className="tabs-bar" role="tablist" aria-orientation="horizontal">
        {visibleTabs.map((tab, idx) => (
          <TabButton
            key={tab.id}
            workspaceId={workspace.id}
            projectId={workspace.project_id}
            id={tab.id}
            tab={tab}
            label={displayLabel(tab, idx)}
            active={activeTab === tab.id}
            isOnly={visibleTabs.length <= 1}
            onClose={() => void closeTab(tab.id)}
          />
        ))}
        {/* Phase 23.B note: the tab-strip activity badge is rendered
            *inside* TabButton (via `useDataState`) so the dot tracks
            its tab even as tabs reorder. The component only paints
            the badge when the tab is non-active and the slice's state
            is non-idle — see TabButton below. */}
        <div className="new-tab">
          <IconButton
            label="New tab"
            shortcut="⌘T"
            onClick={() => void onOpenTab()}
            disabled={opening}
            aria-busy={opening || undefined}
          >
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
              key={workspace.id}
              workspace={workspace}
              tabId={activeTab}
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

/** Pick a title for a freshly opened tab. We scan every tab the workspace
 *  has ever held — including closed ones — so we never collide with a
 *  prior title. Closing tab 2 of (1, 2, 3) and opening a new one yields
 *  "Tab 4", not a second "Tab 3". B10. */
function nextTabTitle(allTabs: ReadonlyArray<Tab>): string {
  let max = 0;
  for (const t of allTabs) {
    const m = /^Tab (\d+)$/.exec(t.title);
    if (m) {
      const n = Number(m[1]);
      if (n > max) max = n;
    }
  }
  return `Tab ${max + 1}`;
}

function TabButton({
  id,
  workspaceId,
  projectId,
  tab,
  label,
  active,
  isOnly = false,
  onClose,
}: {
  id: Tab["id"];
  workspaceId: string;
  projectId: string;
  tab: Tab;
  label: string;
  active: boolean;
  isOnly?: boolean;
  onClose?: () => void;
}) {
  // Phase 23.B — tab-strip badge: paint a small dot when the tab the
  // user *isn't* viewing has activity in flight. Active tabs already
  // surface activity via the dock row, so doubling up there would
  // just be noise. `awaiting_approval` paints in --warning, `working`
  // in --accent — the colors carry the same semantic separation as
  // the dock row's pulse vs. chevron.
  const slice = useDataState((s) => s.activity[activityKey(workspaceId, id)]);
  const showBadge: ActivityState | null = !active && slice ? slice.state : null;
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const commitRename = async (next: string) => {
    setRenaming(false);
    try {
      await ipcClient().renameTab(workspaceId, id, next);
      await refreshWorkspaces(projectId);
    } catch (err) {
      console.error("rename_tab failed", err);
    }
  };

  const items: ContextMenuItem[] = [
    {
      label: "Rename",
      shortcut: "↵",
      onSelect: () => setRenaming(true),
    },
    ...(onClose && !isOnly
      ? [
          {
            label: "Close tab",
            shortcut: "⌘W",
            onSelect: onClose,
            destructive: true,
          },
        ]
      : []),
  ];

  return (
    <div className="tab-button-wrap" data-active={active}>
      <Tooltip
        label={renaming ? "" : label}
        shortcut={active && onClose ? "⌘W" : undefined}
      >
        <button
          type="button"
          role="tab"
          id={`tab-${workspaceId}-${id}`}
          aria-selected={active}
          aria-controls={`tabpanel-${id}`}
          tabIndex={active ? 0 : -1}
          className="tab-button"
          data-active={active}
          data-renaming={renaming || undefined}
          onClick={() => {
            if (renaming) return;
            selectTab(workspaceId, id);
          }}
          onDoubleClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setRenaming(true);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setMenu({ x: e.clientX, y: e.clientY });
          }}
          onAuxClick={(e) => {
            if (e.button === 1 && onClose) {
              e.preventDefault();
              onClose();
            }
          }}
          onKeyDown={(e) => {
            if (renaming) return;
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
          {showBadge && (
            <span
              className="tab-button__activity-badge"
              data-state={showBadge}
              aria-label={
                showBadge === "awaiting_approval"
                  ? "Awaiting approval"
                  : "Working"
              }
            />
          )}
          {renaming ? (
            <RenameInput
              initialValue={tab.title}
              ariaLabel={`Rename tab ${label}`}
              className="tab-button__label tab-button__rename"
              onCommit={(next) => void commitRename(next)}
              onCancel={() => setRenaming(false)}
            />
          ) : (
            <span className="tab-button__label">{label}</span>
          )}
        </button>
      </Tooltip>
      {menu && (
        <RowContextMenu
          x={menu.x}
          y={menu.y}
          items={items}
          onDismiss={() => setMenu(null)}
        />
      )}
      {onClose && (
        <button
          type="button"
          className="tab-button__close"
          // frc_019dea6b — every workspace must have at least one open
          // tab. The data-only-tab hook keeps the visibility-revealing
          // hover/active rules in tabs.css from un-hiding this X and
          // disables pointer events so a click-through can't fire it.
          // Inlined-style would also work but a class-driven hook keeps
          // the token-driven motion in CSS, not React.
          data-only-tab={isOnly || undefined}
          aria-label={
            isOnly
              ? `Close ${label} (last tab — open another to close this one)`
              : `Close ${label}`
          }
          aria-disabled={isOnly || undefined}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            if (isOnly) return;
            onClose();
          }}
        >
          <IconX size={16} />
        </button>
      )}
    </div>
  );
}

