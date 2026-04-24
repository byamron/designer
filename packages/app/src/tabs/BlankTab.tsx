import { useMemo } from "react";
import { AlignLeft, BookOpen, Compass, FileText } from "lucide-react";
import type { Tab, Workspace } from "../ipc/types";
import { TabLayout } from "../layout/TabLayout";
import { Palette, type PaletteSuggestion } from "../components/Palette";

const ICON_PROPS = { size: 16, strokeWidth: 1.5, "aria-hidden": true as const };

/**
 * Blank tab = a palette scoped to the active workspace. Same pattern as
 * the project-home palette on HomeTabA, but suggestions speak in terms
 * of *this workspace* rather than the whole project.
 */
export function BlankTab({ workspace }: { tab: Tab; workspace: Workspace }) {
  const suggestions = useMemo<PaletteSuggestion[]>(
    () => [
      {
        id: "summarize",
        icon: <AlignLeft {...ICON_PROPS} />,
        label: `Summarize the last 10 events in ${workspace.name}`,
        meta: "spine · context",
      },
      {
        id: "directions",
        icon: <Compass {...ICON_PROPS} />,
        label: "Propose three directions for the next iteration",
        meta: "team-lead",
      },
      {
        id: "status",
        icon: <FileText {...ICON_PROPS} />,
        label: "Draft a status report for Friday",
        meta: "reports",
      },
      {
        id: "spec-review",
        icon: <BookOpen {...ICON_PROPS} />,
        label: "Review the spec and flag anything unclear",
        meta: "auditor",
      },
    ],
    [workspace.name],
  );

  return (
    <TabLayout>
      <Palette
        placeholder={`Compose something in ${workspace.name}…`}
        ariaLabel={`Compose in ${workspace.name}`}
        suggestions={suggestions}
      />
    </TabLayout>
  );
}
