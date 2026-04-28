import { useEffect } from "react";
import type { Autonomy, Project, WorkspaceSummary } from "../ipc/types";
import {
  markNoticedViewed,
  selectWorkspace,
  selectTab,
  setAutonomyOverride,
  toggleInbox,
  useAppState,
} from "../store/app";
import { useDataState } from "../store/data";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { TabLayout } from "../layout/TabLayout";
import { SegmentedToggle } from "../components/SegmentedToggle";
import { WorkspaceStatusIcon } from "../components/WorkspaceStatusIcon";
import { DesignerNoticedHome } from "../components/DesignerNoticed";

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

  // Phase 21.A1.1 — opening the home tab is the "I'm caught up"
  // signal for the Designer noticed unread badge. Fire once per
  // mount + project switch; the badge represents what's new since
  // the user last looked, not a real-time count while they sit on
  // this tab. New findings stream into the section directly.
  useEffect(() => {
    markNoticedViewed();
  }, [project.id]);

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

        <Section label="Near-term focus">
          <ol className="home-a__steps">
            <li data-done="true">Draft plan + reviewable artifacts</li>
            <li data-done="true">Design exploration with variants</li>
            <li>Implementation + audit-checked PR</li>
          </ol>
        </Section>

        <Section
          label="Active workspaces"
          trailing={<span className="home-a__count">{projectWorkspaces.length}</span>}
        >
          <ul className="home-a__list home-a__list--workspaces">
            {projectWorkspaces.slice(0, 8).map((w) => (
              <li key={w.workspace.id}>
                {w.workspace.status ? (
                  <WorkspaceStatusIcon status={w.workspace.status} />
                ) : (
                  <span className="state-dot" data-state={w.state} aria-hidden="true" />
                )}
                <button
                  type="button"
                  className="home-a__row-title home-a__row-link"
                  title={`Open ${w.workspace.name}`}
                  onClick={() => openWorkspace(w.workspace.id)}
                >
                  {w.workspace.name}
                </button>
                <span className="home-a__row-meta">
                  {workspaceSummary(w)}
                </span>
              </li>
            ))}
          </ul>
        </Section>

        <Section label="Recent reports">
          <ul className="home-a__list">
            <li>
              <span className="home-a__row-title">Monday recap</span>
              <span className="home-a__row-meta">team-lead · 8:42</span>
            </li>
            <li>
              <span className="home-a__row-title">Audit: scope on auth module</span>
              <span className="home-a__row-meta">auditor · yesterday</span>
            </li>
          </ul>
        </Section>

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
