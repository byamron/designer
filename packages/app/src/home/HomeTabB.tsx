import { useMemo } from "react";
import type { Project, WorkspaceSummary } from "../ipc/types";
import { selectTab, selectWorkspace, toggleInbox } from "../store/app";
import { useDataState } from "../store/data";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { TabLayout } from "../layout/TabLayout";
import { Palette, type PaletteSuggestion } from "../components/Palette";

/**
 * Home — variant B: palette-first, project-scoped.
 *
 * Dia-inspired: centered prompt with 4–5 context-aware suggested actions.
 * Palette primitive is shared with BlankTab — one layout, two scopes.
 */
export function HomeTabB({ project }: { project: Project }) {
  const events = useDataState((s) => s.events);
  const workspaces = useDataState((s) => s.workspaces);

  const projectWorkspaces: WorkspaceSummary[] =
    workspaces[project.id] ?? emptyArray();

  const needsYou = useMemo(
    () =>
      events.filter(
        (e) => e.kind === "approval_requested" || e.kind === "auditor_flagged",
      ),
    [events],
  );

  const enterWorkspace = (w: WorkspaceSummary) => {
    selectWorkspace(w.workspace.id);
    const first = w.workspace.tabs.find((t) => !t.closed_at);
    if (first) selectTab(w.workspace.id, first.id);
  };

  const suggestions = useMemo<PaletteSuggestion[]>(() => {
    const list: PaletteSuggestion[] = [];

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

    return list.slice(0, 6);
  }, [needsYou, projectWorkspaces]);

  return (
    <TabLayout>
      <Palette
        placeholder="What would you like to do?"
        ariaLabel={`What would you like to do in ${project.name}?`}
        suggestions={suggestions}
      />
    </TabLayout>
  );
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
