import { useEffect, useMemo, useRef, useState } from "react";
import { Archive, ChevronDown, ChevronRight, House, RotateCcw, Trash2 } from "lucide-react";
import {
  PANE_DEFAULT_WIDTH,
  commitSidebarWidth,
  selectTab,
  selectWorkspace,
  setSidebarWidthLive,
  toggleSidebar,
  useAppState,
} from "../store/app";
import {
  latestActivityForWorkspace,
  refreshWorkspaces,
  useDataState,
  useRecentActivity,
} from "../store/data";
import { ipcClient } from "../ipc/client";
import { invoke, isTauri } from "../ipc/tauri";
import { EVENT_KIND, type TrackSummary, type Workspace, type WorkspaceSummary } from "../ipc/types";
import { emptyArray } from "../util/empty";
import { IconButton } from "../components/IconButton";
import { Tooltip } from "../components/Tooltip";
import { PaneResizer } from "../components/PaneResizer";
import { WorkspaceStatusIcon } from "../components/WorkspaceStatusIcon";
import { IconPlus, IconCollapseLeft, IconPullRequest } from "../components/icons";

export function WorkspaceSidebar() {
  const activeProjectId = useAppState((s) => s.activeProject);
  const activeWorkspaceId = useAppState((s) => s.activeWorkspace);
  const sidebarWidth = useAppState((s) => s.sidebarWidth);
  const noticedLastViewedSeq = useAppState((s) => s.noticedLastViewedSeq);
  const allWorkspaces = useDataState<WorkspaceSummary[]>((s) =>
    activeProjectId ? s.workspaces[activeProjectId] ?? emptyArray() : emptyArray(),
  );
  // Active rows render in the main list; archived rows appear in a
  // collapsible section at the bottom of the sidebar.
  const workspaces = useMemo(
    () => allWorkspaces.filter((w) => w.workspace.state !== "archived"),
    [allWorkspaces],
  );
  const archivedWorkspaces = useMemo(
    () => allWorkspaces.filter((w) => w.workspace.state === "archived"),
    [allWorkspaces],
  );
  const [archivedExpanded, setArchivedExpanded] = useState(false);
  // Phase 21.A1.2 — badge counts proposals, not findings. Findings
  // are scratch buffer state (continuous, evidence-shaped); proposals
  // are the boundary-driven user-facing unit. Counting findings would
  // make the badge increment per-event, against the boundary cadence.
  const noticedUnread = useDataState((s) =>
    s.events.reduce(
      (acc, e) =>
        e.kind === EVENT_KIND.PROPOSAL_EMITTED &&
        e.sequence > noticedLastViewedSeq
          ? acc + 1
          : acc,
      0,
    ),
  );
  const projects = useDataState((s) => s.projects);
  const activeProject = useMemo(
    () => projects.find((p) => p.project.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  // Guards against rapid double-clicks: `workspaces.length` only updates
  // after `refreshWorkspaces` resolves, so two synchronous clicks would
  // otherwise both compute the same `Workspace N` name and create two
  // identically-named workspaces. The ref also disables the button while
  // the IPC round-trip is in flight.
  const creatingRef = useRef(false);
  const [isCreating, setIsCreating] = useState(false);

  const onCreate = async () => {
    if (!activeProjectId || creatingRef.current) return;
    creatingRef.current = true;
    setIsCreating(true);
    try {
      const name = `Workspace ${workspaces.length + 1}`;
      const summary = await ipcClient().createWorkspace({
        project_id: activeProjectId,
        name,
        base_branch: "main",
      });
      const tab = await ipcClient().openTab({
        workspace_id: summary.workspace.id,
        title: "Tab 1",
        template: "thread",
      });
      await refreshWorkspaces(activeProjectId);
      selectWorkspace(summary.workspace.id);
      selectTab(summary.workspace.id, tab.id);
    } catch (err) {
      // Surface the failure — the previous prompt-based flow swallowed
      // errors silently, which is exactly the "button does nothing" bug
      // the user reported. Log so devs can diagnose; a toast surface is
      // tracked separately.
      console.error("create_workspace failed", err);
    } finally {
      creatingRef.current = false;
      setIsCreating(false);
    }
  };

  const onHome = () => selectWorkspace(null);
  const homeActive = activeProjectId !== null && activeWorkspaceId === null;

  return (
    <aside
      className="app-sidebar"
      data-component="WorkspaceSidebar"
      aria-label="Workspaces"
      style={{ width: sidebarWidth }}
    >
      <PaneResizer
        side="right"
        width={sidebarWidth}
        onLiveChange={setSidebarWidthLive}
        onCommit={commitSidebarWidth}
        defaultWidth={PANE_DEFAULT_WIDTH}
        ariaLabel="Resize workspaces pane"
      />
      <header className="sidebar-header">
        <div className="sidebar-header__row">
          <strong className="sidebar-title">
            {activeProject?.project.name ?? "Pick a project"}
          </strong>
          {activeWorkspaceId && <RequestMergeButton workspaceId={activeWorkspaceId} />}
          <IconButton
            label="Hide workspaces"
            shortcut="⌘["
            onClick={() => toggleSidebar(false)}
          >
            <IconCollapseLeft />
          </IconButton>
        </div>
        {activeProject && (
          <Tooltip label={`Reveal ${activeProject.project.root_path} in Finder`}>
            <button
              type="button"
              className="sidebar-path"
              onClick={() => revealInFinder(activeProject.project.root_path)}
            >
              {activeProject.project.root_path}
            </button>
          </Tooltip>
        )}
      </header>

      <Tooltip
        label={
          noticedUnread > 0
            ? `Project home — ${noticedUnread} new from Designer noticed`
            : "Project home"
        }
      >
        <button
          type="button"
          className="sidebar-home"
          data-active={homeActive}
          onClick={onHome}
          disabled={!activeProjectId}
        >
          <House size={16} strokeWidth={1.5} aria-hidden="true" />
          <span className="sidebar-home__label">
            <span>Home</span>
            {noticedUnread > 0 && (
              <span className="sidebar-home__badge" aria-hidden="true">
                {noticedUnread > 99 ? "99+" : noticedUnread}
              </span>
            )}
          </span>
        </button>
      </Tooltip>

      <div className="sidebar-group">
        <div className="sidebar-group__head">
          <span className="sidebar-label">Workspaces</span>
          <IconButton
            label="New workspace"
            shortcut="⌘⇧N"
            onClick={onCreate}
            disabled={!activeProjectId || isCreating}
          >
            <IconPlus />
          </IconButton>
        </div>
        {workspaces.length === 0 ? (
          <p className="sidebar-empty">
            {archivedWorkspaces.length > 0
              ? "No active workspaces — see Archived below."
              : "No workspaces yet."}
          </p>
        ) : (
          <ul className="sidebar-list" role="list">
            {workspaces.map((summary) => (
              <WorkspaceRow
                key={summary.workspace.id}
                workspace={summary.workspace}
                active={activeWorkspaceId === summary.workspace.id}
                projectId={activeProjectId}
              />
            ))}
          </ul>
        )}
      </div>

      {archivedWorkspaces.length > 0 && (
        <div className="sidebar-group sidebar-group--archived">
          <button
            type="button"
            className="sidebar-group__head sidebar-group__head--toggle"
            onClick={() => setArchivedExpanded((v) => !v)}
            aria-expanded={archivedExpanded}
          >
            {archivedExpanded ? (
              <ChevronDown size={12} strokeWidth={1.5} aria-hidden="true" />
            ) : (
              <ChevronRight size={12} strokeWidth={1.5} aria-hidden="true" />
            )}
            <span className="sidebar-label">
              Archived ({archivedWorkspaces.length})
            </span>
          </button>
          {archivedExpanded && (
            <ul className="sidebar-list" role="list">
              {archivedWorkspaces.map((summary) => (
                <ArchivedWorkspaceRow
                  key={summary.workspace.id}
                  workspace={summary.workspace}
                  projectId={activeProjectId}
                />
              ))}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}

/**
 * Reveal a repo root in Finder. In Tauri we call the `reveal_in_finder`
 * IPC command (TODO(13.E): wire the Rust side to NSWorkspace). In the
 * web/dev build we can't shell out, so we copy the path to the clipboard
 * and return silently — the user still has a usable affordance without
 * needing to manually select the text.
 */
async function revealInFinder(path: string): Promise<void> {
  if (isTauri()) {
    try {
      await invoke<void>("reveal_in_finder", { path });
      return;
    } catch (err) {
      console.warn("reveal_in_finder failed; falling back to clipboard", err);
    }
  }
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(path);
    } catch {
      // clipboard blocked (insecure context or user gesture gated) — no-op
    }
  }
}

/**
 * Lightest-touch placement for the Request Merge action: an icon button in
 * the sidebar header next to the workspace name. Surfaces only when the
 * active workspace has at least one mergeable track. Click runs
 * `cmd_request_merge` on the most recent track that's still merge-eligible.
 */
function RequestMergeButton({ workspaceId }: { workspaceId: string }) {
  const [tracks, setTracks] = useState<TrackSummary[]>([]);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    void ipcClient()
      .listTracks(workspaceId)
      .then((rows) => mounted && setTracks(rows))
      .catch(() => mounted && setTracks([]));
    return () => {
      mounted = false;
    };
  }, [workspaceId]);
  const target = useMemo(() => {
    return [...tracks]
      .reverse()
      .find((t) => t.state === "active" || t.state === "requesting_merge");
  }, [tracks]);
  if (!target) return null;
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipcClient().requestMerge({ track_id: target.id });
      const refreshed = await ipcClient().listTracks(workspaceId);
      setTracks(refreshed);
    } catch (err) {
      console.warn("request merge failed", err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <IconButton
      label={busy ? "Requesting merge…" : `Request merge — ${target.branch}`}
      onClick={onClick}
      disabled={busy}
    >
      <IconPullRequest />
    </IconButton>
  );
}

function WorkspaceRow({
  workspace,
  active,
  projectId,
}: {
  workspace: Workspace;
  active: boolean;
  projectId: string | null;
}) {
  // Pulse the state dot only while the workspace's stream has had a
  // recent event. The `state === "active"` projection alone counts a
  // touched-but-quiet workspace as active; that's what made every row
  // pulse forever after the first message. Combine the projection
  // bit with this gate via `data-active-ts-recent` in CSS.
  const latestTs = useDataState((s) =>
    latestActivityForWorkspace(s.recentActivityTs, workspace.id),
  );
  const recent = useRecentActivity(latestTs);
  const [busy, setBusy] = useState(false);
  // frc_019dea6b — opening a workspace must always land the user on a
  // tab. If the workspace has zero open tabs (e.g. the user closed the
  // last one before this guard landed, or a legacy workspace from
  // pre-23.E was never seeded), lazy-create "Tab 1". Mirrors the
  // onCreate flow above. The ref prevents a double-click from spawning
  // two tabs while the first openTab IPC is in flight.
  const openingTabRef = useRef(false);
  const onSelect = async () => {
    if (openingTabRef.current) {
      selectWorkspace(workspace.id);
      return;
    }
    const firstOpen = workspace.tabs.find((t) => !t.closed_at);
    if (firstOpen) {
      selectWorkspace(workspace.id);
      selectTab(workspace.id, firstOpen.id);
      return;
    }
    openingTabRef.current = true;
    try {
      const tab = await ipcClient().openTab({
        workspace_id: workspace.id,
        title: "Tab 1",
        template: "thread",
      });
      if (projectId) await refreshWorkspaces(projectId);
      selectWorkspace(workspace.id);
      selectTab(workspace.id, tab.id);
    } catch (err) {
      console.error("auto-create tab on workspace open failed", err);
      // Still select the workspace so the user isn't left without
      // visible feedback that their click registered.
      selectWorkspace(workspace.id);
    } finally {
      openingTabRef.current = false;
    }
  };
  const onArchive = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      await ipcClient().archiveWorkspace(workspace.id);
      if (projectId) await refreshWorkspaces(projectId);
      // If the archived workspace was active, drop the selection so the
      // main pane returns to the project home and doesn't render an
      // archived tab thread.
      if (active) selectWorkspace(null);
    } catch (err) {
      console.error("archive_workspace failed", err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-component="WorkspaceRow" className="workspace-row__wrap">
      <button
        type="button"
        className="workspace-row"
        data-active={active}
        title={`${workspace.name} · ${workspace.base_branch}`}
        onClick={() => void onSelect()}
      >
        {workspace.status ? (
          <WorkspaceStatusIcon status={workspace.status} />
        ) : (
          <span
            className="state-dot"
            data-state={workspace.state}
            data-active-ts-recent={recent ? "true" : undefined}
            aria-hidden="true"
          />
        )}
        <span className="workspace-row__title">{workspace.name}</span>
      </button>
      <span className="workspace-row__actions">
        <IconButton
          label={busy ? "Archiving…" : `Archive ${workspace.name}`}
          onClick={onArchive}
          disabled={busy}
        >
          <Archive size={14} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </span>
    </li>
  );
}

function ArchivedWorkspaceRow({
  workspace,
  projectId,
}: {
  workspace: Workspace;
  projectId: string | null;
}) {
  const [busy, setBusy] = useState(false);
  const onRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipcClient().restoreWorkspace(workspace.id);
      if (projectId) await refreshWorkspaces(projectId);
    } catch (err) {
      console.error("restore_workspace failed", err);
    } finally {
      setBusy(false);
    }
  };
  const onDelete = async () => {
    if (busy) return;
    // The event log is append-only; past events tied to this workspace
    // remain on disk for audit. What the user actually loses is access:
    // the workspace stops resolving in the projector, so the chat is no
    // longer reachable from the UI. The copy reflects that — "lost" was
    // wrong (events stay) and "removed" is too vague.
    const ok = window.confirm(
      `Permanently delete '${workspace.name}'? Its chat will no longer be accessible.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await ipcClient().deleteWorkspace(workspace.id);
      if (projectId) await refreshWorkspaces(projectId);
    } catch (err) {
      console.error("delete_workspace failed", err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-component="ArchivedWorkspaceRow" className="workspace-row__wrap">
      <span className="workspace-row workspace-row--archived" title={workspace.name}>
        <span className="workspace-row__title">{workspace.name}</span>
      </span>
      <span className="workspace-row__actions">
        <IconButton
          label={busy ? "Restoring…" : `Restore ${workspace.name}`}
          onClick={onRestore}
          disabled={busy}
        >
          <RotateCcw size={14} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
        <IconButton
          label={busy ? "Deleting…" : `Delete ${workspace.name} permanently`}
          onClick={onDelete}
          disabled={busy}
        >
          <Trash2 size={14} strokeWidth={1.5} aria-hidden="true" />
        </IconButton>
      </span>
    </li>
  );
}

