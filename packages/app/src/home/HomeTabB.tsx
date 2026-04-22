import { useMemo, useState } from "react";
import type { Project, WorkspaceSummary } from "../ipc/types";
import { selectTab, selectWorkspace, toggleInbox, toggleQuickSwitcher } from "../store/app";
import { useDataState } from "../store/data";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { TabLayout } from "../layout/TabLayout";

/**
 * Home — variant B: palette-first, project-scoped.
 *
 * Dia-inspired: centered prompt with 4–6 context-aware suggested actions.
 * No grid, no cards, minimal chrome. The brief (vision, focus, attention,
 * autonomy) is one click away via the drill-in, not shown by default.
 */
export function HomeTabB({ project }: { project: Project }) {
  const events = useDataState((s) => s.events);
  const workspaces = useDataState((s) => s.workspaces);
  const [briefOpen, setBriefOpen] = useState(false);

  const projectWorkspaces: WorkspaceSummary[] =
    workspaces[project.id] ?? emptyArray();

  const needsYou = events.filter(
    (e) => e.kind === "approval_requested" || e.kind === "auditor_flagged",
  );

  const enterWorkspace = (w: WorkspaceSummary) => {
    selectWorkspace(w.workspace.id);
    const first = w.workspace.tabs.find((t) => !t.closed_at);
    if (first) selectTab(w.workspace.id, first.id);
  };

  const suggestions = useMemo<Suggestion[]>(() => {
    const list: Suggestion[] = [];

    for (const event of needsYou.slice(0, 2)) {
      list.push({
        id: `attention:${event.stream_id}:${event.sequence}`,
        icon: <IconAlert />,
        label: humanizeKind(event.kind),
        meta: event.summary ?? "Waiting on you",
        onClick: () => toggleInbox(true),
      });
    }

    const active = projectWorkspaces.find((w) => w.state === "active");
    if (active) {
      list.push({
        id: `continue:${active.workspace.id}`,
        icon: <IconBranch />,
        label: `Continue on ${active.workspace.name}`,
        meta: `${active.workspace.base_branch} · ${active.state}`,
        onClick: () => enterWorkspace(active),
      });
    }

    list.push({
      id: "draft-plan",
      icon: <IconPlan />,
      label: "Draft a plan",
      meta: "Open a new Plan tab",
    });

    list.push({
      id: "read-recap",
      icon: <IconReport />,
      label: "Read the Monday recap",
      meta: "team-lead · 8:42",
    });

    if (projectWorkspaces.length > 1) {
      list.push({
        id: "switch-workspace",
        icon: <IconSwitch />,
        label: "Switch workspace",
        meta: `${projectWorkspaces.length} in this project`,
        onClick: () => toggleQuickSwitcher(true),
      });
    }

    return list.slice(0, 6);
  }, [needsYou, projectWorkspaces]);

  return (
    <TabLayout>
      <div className="home-b">
      <div className="home-b__stage">
        <div className="home-b__prompt">
          <input
            type="text"
            className="home-b__input"
            placeholder="What would you like to do?"
            aria-label={`What would you like to do in ${project.name}?`}
            title={`Ask anything or start a task in ${project.name}`}
          />
        </div>

        <ul className="home-b__suggestions" aria-label="Suggested next steps">
          {suggestions.map((s) => (
            <li key={s.id}>
              <button
                type="button"
                className="home-b__suggestion"
                title={`${s.label} — ${s.meta}`}
                onClick={s.onClick}
              >
                <span className="home-b__suggestion-icon" aria-hidden="true">
                  {s.icon}
                </span>
                <span className="home-b__suggestion-label">{s.label}</span>
                <span className="home-b__suggestion-meta">{s.meta}</span>
              </button>
            </li>
          ))}
        </ul>

        <button
          type="button"
          className="home-b__brief-toggle"
          aria-expanded={briefOpen}
          aria-controls="home-b-brief"
          title={briefOpen ? "Collapse the project brief" : "Show vision, focus, attention, autonomy"}
          onClick={() => setBriefOpen((o) => !o)}
        >
          {briefOpen ? "Hide brief" : "Show brief"}
        </button>

        {briefOpen && (
          <div id="home-b-brief" className="home-b__brief" role="region" aria-label="Workspace brief">
            <div className="home-b__brief-row">
              <span className="home-b__brief-label">Vision</span>
              <p className="home-b__brief-body">
                Every workspace starts from intent. The vision slab is hand-edited
                and read by every agent. One paragraph beats five.
              </p>
            </div>
            <div className="home-b__brief-row">
              <span className="home-b__brief-label">Focus</span>
              <p className="home-b__brief-body">
                Draft plan, design exploration with variants, audit-checked PR.
              </p>
            </div>
            <div className="home-b__brief-row">
              <span className="home-b__brief-label">Attention</span>
              <p className="home-b__brief-body">
                {needsYou.length === 0
                  ? "Nothing is waiting on you."
                  : `${needsYou.length} item${needsYou.length === 1 ? "" : "s"} pending.`}
              </p>
            </div>
            <div className="home-b__brief-row">
              <span className="home-b__brief-label">Autonomy</span>
              <p className="home-b__brief-body">Suggest · agents propose, you decide.</p>
            </div>
          </div>
        )}
      </div>
      </div>
    </TabLayout>
  );
}

interface Suggestion {
  id: string;
  icon: React.ReactNode;
  label: string;
  meta: string;
  onClick?: () => void;
}

/* ---- Icons ---------------------------------------------------------- */

function IconAlert() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d="M7 2.5v5" />
      <circle cx="7" cy="10.5" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  );
}

function IconBranch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <circle cx="3.5" cy="3" r="1" />
      <circle cx="3.5" cy="11" r="1" />
      <circle cx="10.5" cy="7" r="1" />
      <path d="M3.5 4v6" />
      <path d="M3.5 7h6" />
    </svg>
  );
}

function IconPlan() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d="M3 2.5h6l2 2v7H3z" />
      <path d="M5 6.5h4" />
      <path d="M5 9h3" />
    </svg>
  );
}

function IconReport() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <rect x="2.5" y="3" width="9" height="8" rx="1" />
      <path d="M4.5 6h5" />
      <path d="M4.5 8h3" />
    </svg>
  );
}

function IconSwitch() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d="M3 5h8l-2-2" />
      <path d="M11 9H3l2 2" />
    </svg>
  );
}
