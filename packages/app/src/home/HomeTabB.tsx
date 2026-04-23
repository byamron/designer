import { useMemo } from "react";
import { AlertCircle, ClipboardList, FileText } from "lucide-react";
import type { Project, WorkspaceSummary } from "../ipc/types";
import { selectTab, selectWorkspace, toggleInbox } from "../store/app";
import { useDataState } from "../store/data";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { TabLayout } from "../layout/TabLayout";
import { Palette, type PaletteSuggestion } from "../components/Palette";
import { IconBranch } from "../components/icons";

const ICON_PROPS = { size: 14, strokeWidth: 1.25, "aria-hidden": true as const };

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
        icon: <AlertCircle {...ICON_PROPS} />,
        label: humanizeKind(event.kind),
        meta: event.summary ?? "Waiting on you",
        onClick: () => toggleInbox(true),
      });
    }

    const active = projectWorkspaces.find((w) => w.state === "active");
    if (active) {
      list.push({
        id: `continue:${active.workspace.id}`,
        icon: <IconBranch size={14} />,
        label: `Continue on ${active.workspace.name}`,
        meta: `${active.workspace.base_branch} · ${active.state}`,
        onClick: () => enterWorkspace(active),
      });
    }

    list.push({
      id: "draft-plan",
      icon: <ClipboardList {...ICON_PROPS} />,
      label: "Draft a plan",
      meta: "Open a new Plan tab",
    });

    list.push({
      id: "read-recap",
      icon: <FileText {...ICON_PROPS} />,
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
