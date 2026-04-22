import type { Workspace, WorkspaceSummary } from "../ipc/types";
import { useAppState, toggleInbox } from "../store/app";
import { useDataState } from "../store/data";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";

/**
 * Home tab. Notion-style page with live blocks:
 * - Vision (hand-edited)
 * - Roadmap (AI-maintained with approval)
 * - Active workspaces
 * - Recent reports
 * - Needs-your-attention
 *
 * Scales across workspaces via the four-tier attention model: content on this
 * surface is always "ambient" tier — summarized, not streaming.
 */
export function HomeTab({ workspace }: { workspace: Workspace }) {
  const events = useDataState((s) => s.events);
  const projects = useDataState((s) => s.projects);
  const workspaces = useDataState((s) => s.workspaces);
  const inboxOpen = useAppState((s) => s.inboxOpen);
  void inboxOpen;

  const project = projects.find((p) => p.project.id === workspace.project_id);
  const projectWorkspaces: WorkspaceSummary[] =
    workspaces[workspace.project_id] ?? emptyArray();

  const needsYou = events.filter(
    (e) => e.kind === "approval_requested" || e.kind === "auditor_flagged",
  );

  return (
    <>
      <header
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "var(--space-2)",
        }}
      >
        <span className="card__kicker">Home</span>
        <h2 className="tab-title">{workspace.name}</h2>
        <p className="tab-subtitle">
          {project?.project.name} · {workspace.base_branch} · {workspace.state}
        </p>
      </header>

      <div className="home-grid">
        <Card kicker="Vision" title="Why this workspace exists">
          <p style={{ margin: 0 }}>
            Every workspace starts from intent. The vision slab is hand-edited
            and read by every agent in the team as shared context. Keep it
            short. One paragraph beats five.
          </p>
        </Card>

        <Card kicker="Roadmap" title="Near-term focus">
          <ol style={{ margin: 0, paddingLeft: "var(--space-4)", display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <li>Draft plan + reviewable artifacts</li>
            <li>Design exploration with variants</li>
            <li>Implementation + audit-checked PR</li>
          </ol>
          <div className="card__footer">
            <button type="button" className="btn">View full roadmap</button>
          </div>
        </Card>

        <Card kicker="Active workspaces" title={`${projectWorkspaces.length} in this project`}>
          <ul role="list" style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", margin: 0, padding: 0 }}>
            {projectWorkspaces.slice(0, 4).map((w) => (
              <li key={w.workspace.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "var(--space-2)" }}>
                <span>
                  <span className="state-dot" data-state={w.state} aria-hidden="true" />
                  <span style={{ marginLeft: "var(--space-2)" }}>{w.workspace.name}</span>
                </span>
                <span className="workspace-row__meta">{w.workspace.base_branch}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card kicker="Recent reports" title="Agent-authored">
          <ul role="list" style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
            <li>
              <strong>Monday recap</strong>
              <div className="workspace-row__meta">team-lead · 8:42</div>
            </li>
            <li>
              <strong>Audit: scope on auth module</strong>
              <div className="workspace-row__meta">auditor · yesterday</div>
            </li>
          </ul>
          <div className="card__footer">
            <button type="button" className="btn">Open library</button>
          </div>
        </Card>

        <Card
          kicker="Needs your attention"
          title={needsYou.length === 0 ? "All clear" : `${needsYou.length} pending`}
        >
          {needsYou.length === 0 ? (
            <p style={{ margin: 0, color: "var(--color-muted)" }}>
              Nothing is waiting on you — the team is working.
            </p>
          ) : (
            <ul role="list" style={{ margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: "var(--space-2)" }}>
              {needsYou.slice(0, 3).map((e) => (
                <li key={`${e.stream_id}:${e.sequence}`}>
                  <strong>{humanizeKind(e.kind)}</strong>
                  <div className="workspace-row__meta">{e.summary}</div>
                </li>
              ))}
            </ul>
          )}
          <div className="card__footer">
            <button type="button" className="btn" onClick={() => toggleInbox()}>
              Open inbox
            </button>
          </div>
        </Card>

        <Card kicker="Autonomy" title="Suggest, do not act">
          <p style={{ margin: 0 }}>
            This project is on the default autonomy. Agents propose; you decide.
            Flip per-project settings to <code>act</code> once you trust the team.
          </p>
        </Card>
      </div>
    </>
  );
}

function Card({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card" aria-label={title}>
      <span className="card__kicker">{kicker}</span>
      <h3 className="card__title">{title}</h3>
      {children}
    </section>
  );
}
