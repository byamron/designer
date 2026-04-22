import type { Project, WorkspaceSummary } from "../ipc/types";
import { selectWorkspace, selectTab, toggleInbox } from "../store/app";
import { useDataState } from "../store/data";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { TabLayout } from "../layout/TabLayout";

/**
 * Home — variant A: quieter project dashboard.
 *
 * Scoped to the project. Single column. Panels, not cards. One type size with
 * weight/color doing the hierarchy work.
 */
export function HomeTabA({ project }: { project: Project }) {
  const events = useDataState((s) => s.events);
  const workspaces = useDataState((s) => s.workspaces);

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
        <header className="home-a__kicker">
          <span className="sidebar-label">Project home</span>
          <span className="home-a__kicker-hint">
            Overview of {project.name}. Pick a workspace from the sidebar to
            dive into a specific piece of work.
          </span>
        </header>

        <p className="home-a__lede">
          Every project starts from intent. The vision slab is hand-edited and
          read by every agent. One paragraph beats five.
        </p>

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
          <ul className="home-a__list">
            {projectWorkspaces.slice(0, 8).map((w) => (
              <li key={w.workspace.id}>
                <span className="state-dot" data-state={w.state} aria-hidden="true" />
                <button
                  type="button"
                  className="home-a__row-title home-a__row-link"
                  title={`Open ${w.workspace.name}`}
                  onClick={() => openWorkspace(w.workspace.id)}
                >
                  {w.workspace.name}
                </button>
                <span className="home-a__row-meta">{w.workspace.base_branch}</span>
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

        <Section
          label="Needs your attention"
          trailing={
            needsYou.length === 0 ? (
              <span className="home-a__muted-small">All clear</span>
            ) : (
              <span className="home-a__count" data-variant="warning">{needsYou.length}</span>
            )
          }
        >
          {needsYou.length === 0 ? null : (
            <>
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
            </>
          )}
        </Section>

        <Section label="Autonomy">
          <div className="home-a__autonomy" role="radiogroup" aria-label="Autonomy level">
            <span data-active={project.autonomy === "suggest"}>Suggest</span>
            <span data-active={project.autonomy === "act"}>Act</span>
            <span data-active={project.autonomy === "scheduled"}>Auto</span>
          </div>
        </Section>
      </div>
    </TabLayout>
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
