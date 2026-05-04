import { useEffect, useMemo, useState } from "react";
import type { Autonomy, Project, WorkspaceSummary } from "../ipc/types";
import {
  markNoticedViewed,
  selectWorkspace,
  selectTab,
  setAutonomyOverride,
  toggleInbox,
  useAppState,
} from "../store/app";
import {
  latestActivityForWorkspace,
  refreshWorkspaces,
  useDataState,
  useRecentActivity,
} from "../store/data";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { TabLayout } from "../layout/TabLayout";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { WorkspaceStatusIcon } from "../components/WorkspaceStatusIcon";
import { DesignerNoticedHome } from "../components/DesignerNoticed";
import { RecentReportsSection } from "../components/RecentReports";
import { RepoUnlinkModal } from "../components/RepoUnlinkModal";
import { RepoLinkModal } from "../components/RepoLinkModal";
import { RoadmapCanvas } from "../components/RoadmapCanvas";
import { ipcClient } from "../ipc/client";

/**
 * Home — project dashboard (the committed variant; Palette lives on for
 * BlankTab). Single column. Panels, not cards. One type size with weight
 * and color carrying hierarchy.
 *
 * Section order is intentional: anything that needs your attention jumps
 * to the top; operational state (workspaces, reports) follows; Autonomy
 * sits at the bottom as a settings-adjacent surface.
 */
export function HomeTabA({ project }: { project: Project }) {
  const events = useDataState((s) => s.events);
  const workspaces = useDataState((s) => s.workspaces);
  const autonomyOverride = useAppState((s) => s.autonomyOverrides[project.id]);
  const autonomy: Autonomy = autonomyOverride ?? project.autonomy ?? "suggest";

  // Phase 22.A — opt-in Roadmap canvas variant. When the flag is on,
  // the canvas takes the lead and the Active workspaces / Autonomy /
  // Needs-your-attention sections are deleted at project altitude
  // (those signals live in the workspace strip + adjacent attention
  // column once 22.E ships).
  const [roadmapFlag, setRoadmapFlag] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void ipcClient()
      .getFeatureFlags()
      .then((f) => {
        if (!cancelled) setRoadmapFlag(f.show_roadmap_canvas);
      })
      .catch(() => {
        if (!cancelled) setRoadmapFlag(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Phase 21.A1.1 — opening the home tab is the "I'm caught up"
  // signal for the Designer noticed unread badge. Fire once per
  // mount + project switch; the badge represents what's new since
  // the user last looked, not a real-time count while they sit on
  // this tab. New findings stream into the section directly.
  useEffect(() => {
    markNoticedViewed();
  }, [project.id]);

  // Phase 22.B — feature-flagged Recent Reports surface. Old report
  // rendering on this tab stays unchanged when the flag is off so
  // dogfood installs that haven't opted in keep the existing
  // experience.
  const [showRecentReports, setShowRecentReports] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void ipcClient()
      .getFeatureFlags()
      .then((f) => {
        if (!cancelled) setShowRecentReports(f.show_recent_reports_v2);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const projectWorkspaces: WorkspaceSummary[] =
    workspaces[project.id] ?? emptyArray();

  const needsYou = events.filter(
    (e) => e.kind === "approval_requested" || e.kind === "auditor_flagged",
  );

  const openWorkspace = (id: string) => {
    selectWorkspace(id);
    const ws = projectWorkspaces.find((w) => w.workspace.id === id)?.workspace;
    const firstTab = ws?.tabs.find((t) => !t.closed_at);
    if (firstTab) selectTab(id, firstTab.id);
  };

  if (roadmapFlag) {
    return (
      <TabLayout>
        <div className="home-a">
          <RoadmapCanvas projectId={project.id} />
          <ProjectRepoSection project={project} workspaces={projectWorkspaces} />
          <DesignerNoticedHome projectId={project.id} />
        </div>
      </TabLayout>
    );
  }

  return (
    <TabLayout>
      <div className="home-a">
        {needsYou.length > 0 && (
          <Section
            label="Needs your attention"
            trailing={
              <span className="home-a__count" data-variant="warning">
                {needsYou.length}
              </span>
            }
          >
            <ul className="home-a__list">
              {needsYou.slice(0, 3).map((e) => (
                <li key={`${e.stream_id}:${e.sequence}`}>
                  <span className="state-dot" data-state="needs_you" aria-hidden="true" />
                  <span className="home-a__row-title">{humanizeKind(e.kind)}</span>
                  <span className="home-a__row-meta">{e.summary}</span>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="home-a__link-btn"
              title="Open inbox of pending approvals and attention items"
              onClick={() => toggleInbox()}
            >
              Open inbox →
            </button>
          </Section>
        )}

        <Section
          label="Active workspaces"
          trailing={<span className="home-a__count">{projectWorkspaces.length}</span>}
        >
          <ul className="home-a__list home-a__list--workspaces">
            {projectWorkspaces.slice(0, 8).map((w) => (
              <HomeWorkspaceRow
                key={w.workspace.id}
                summary={w}
                onOpen={() => openWorkspace(w.workspace.id)}
              />
            ))}
          </ul>
        </Section>

        <ProjectRepoSection project={project} workspaces={projectWorkspaces} />

        <Section label="Autonomy">
          <p className="home-a__explain">
            How proactive should agents be on this project?{" "}
            <strong>Suggest</strong> waits for confirmation on every action,{" "}
            <strong>Act</strong> lets the team execute reversible work without
            asking, and <strong>Auto</strong> adds scheduled runs and queued
            handoffs.
          </p>
          <SegmentedToggle<Autonomy>
            ariaLabel="Autonomy level"
            value={autonomy}
            onChange={(next) => setAutonomyOverride(project.id, next)}
            options={[
              { value: "suggest", label: "Suggest", tooltip: "Propose before acting" },
              { value: "act", label: "Act", tooltip: "Execute reversible work automatically" },
              { value: "scheduled", label: "Auto", tooltip: "Scheduled runs + queued handoffs" },
            ]}
          />
        </Section>

        {/* Phase 22.B — Recent Reports sits ABOVE Designer noticed.
            Phase 22.A's Roadmap section, when it lands, slots between
            the two (final order: Recent Reports → Roadmap → Designer
            noticed). */}
        {showRecentReports && <RecentReportsSection projectId={project.id} />}

        <DesignerNoticedHome projectId={project.id} />
      </div>
    </TabLayout>
  );
}

/**
 * One-line summary of what a workspace is up to — prefers the first open
 * tab's title (e.g. "Plan — editing core-docs/plan.md"), falling back to
 * a plain "no open tabs" message. Agents will swap this in for a real
 * summary once LocalOps.summarize_row is wired (Phase 13.F).
 */
function workspaceSummary(w: WorkspaceSummary): string {
  const openTab = w.workspace.tabs.find((t) => !t.closed_at);
  if (openTab?.title) return openTab.title;
  return "no open tabs";
}

/**
 * Per-project repository pane. Lives in Project Home rather than Settings
 * because the linked repo is project-scoped — Settings → Account stays
 * focused on global concerns (Keychain, Claude Code). See spec.md
 * Decision §"Settings scope" (D2026-05).
 *
 * "Disconnect repository" severs Designer's pointer for every workspace
 * in the project. The repo on disk is untouched.
 */
function ProjectRepoSection({
  project,
  workspaces,
}: {
  project: Project;
  workspaces: WorkspaceSummary[];
}) {
  const [unlinkOpen, setUnlinkOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const linkedWorkspaceIds = useMemo(
    () =>
      workspaces
        .filter((w) => !!w.workspace.worktree_path)
        .map((w) => w.workspace.id),
    [workspaces],
  );
  const hasLinkedWorkspace = linkedWorkspaceIds.length > 0;
  // Surface the live worktree path when a workspace is linked; fall back to
  // the project root the user originally picked when nothing is linked
  // (post-disconnect or before the first link).
  const displayedPath = useMemo(() => {
    const linked = workspaces.find((w) => w.workspace.worktree_path);
    return linked?.workspace.worktree_path ?? project.root_path;
  }, [workspaces, project.root_path]);
  // Re-link target: prefer the active project's first workspace so the
  // re-link flow picks up where the user is. Fine to be `null` — the
  // modal short-circuits when there's no workspace yet.
  const linkTarget = workspaces[0]?.workspace ?? null;
  return (
    <Section label="Repository">
      <p className="home-a__explain">
        Designer tracks changes inside this repo so agents can branch + worktree
        without touching your main checkout.
      </p>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "var(--space-3)",
        }}
      >
        <span className="home-a__row-meta" title={displayedPath}>
          {displayedPath}
        </span>
        <div style={{ display: "flex", gap: "var(--space-2)" }}>
          {linkTarget && (
            <button
              type="button"
              className="btn"
              onClick={() => setLinkOpen(true)}
              title={
                hasLinkedWorkspace
                  ? "Re-link this project to a different repo"
                  : "Link this project to a repo on disk"
              }
            >
              {hasLinkedWorkspace ? "Re-link" : "Link"}
            </button>
          )}
          <button
            type="button"
            className="btn"
            data-variant="danger"
            onClick={() => setUnlinkOpen(true)}
            disabled={!hasLinkedWorkspace}
            title={
              hasLinkedWorkspace
                ? "Disconnect Designer from this repo"
                : "Repo is not currently linked to any workspace"
            }
          >
            Disconnect repository
          </button>
        </div>
      </div>
      <RepoUnlinkModal
        workspaceIds={linkedWorkspaceIds}
        repoPath={displayedPath}
        open={unlinkOpen}
        onClose={() => setUnlinkOpen(false)}
        onUnlinked={() => void refreshWorkspaces(project.id)}
      />
      {linkTarget && (
        <RepoLinkModal
          workspaceId={linkTarget.id}
          initialPath={linkTarget.worktree_path ?? project.root_path}
          open={linkOpen}
          onClose={() => setLinkOpen(false)}
          onLinked={() => void refreshWorkspaces(project.id)}
        />
      )}
    </Section>
  );
}

/**
 * Row component so each workspace can run its own `useRecentActivity`
 * gate — keeps the home tab's pulse semantics in sync with the
 * workspace sidebar (a state="active" dot only pulses while the
 * workspace's stream has had a recent event).
 */
function HomeWorkspaceRow({
  summary,
  onOpen,
}: {
  summary: WorkspaceSummary;
  onOpen: () => void;
}) {
  const latestTs = useDataState((s) =>
    latestActivityForWorkspace(s.recentActivityTs, summary.workspace.id),
  );
  const recent = useRecentActivity(latestTs);
  return (
    <li>
      {summary.workspace.status ? (
        <WorkspaceStatusIcon status={summary.workspace.status} />
      ) : (
        <span
          className="state-dot"
          data-state={summary.state}
          data-active-ts-recent={recent ? "true" : undefined}
          aria-hidden="true"
        />
      )}
      <button
        type="button"
        className="home-a__row-title home-a__row-link"
        title={`Open ${summary.workspace.name}`}
        onClick={onOpen}
      >
        {summary.workspace.name}
      </button>
      <span className="home-a__row-meta">{workspaceSummary(summary)}</span>
    </li>
  );
}

function Section({
  label,
  trailing,
  children,
}: {
  label: string;
  trailing?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="home-a__section" aria-label={label}>
      <header className="home-a__section-head">
        <h3 className="home-a__section-label">{label}</h3>
        {trailing && <span className="home-a__section-trailing">{trailing}</span>}
      </header>
      {children}
    </section>
  );
}
