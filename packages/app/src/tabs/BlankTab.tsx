import { useMemo } from "react";
import type { Tab, Workspace } from "../ipc/types";
import { TabLayout } from "../layout/TabLayout";
import { Palette, type PaletteSuggestion } from "../components/Palette";

/**
 * Blank tab = a palette scoped to the active workspace. The same UX as
 * HomeTabB, but suggestions speak in terms of *this workspace* rather
 * than the whole project.
 */
export function BlankTab({ workspace }: { tab: Tab; workspace: Workspace }) {
  const suggestions = useMemo<PaletteSuggestion[]>(
    () => [
      {
        id: "summarize",
        icon: <IconSummary />,
        label: `Summarize the last 10 events in ${workspace.name}`,
        meta: "spine · context",
      },
      {
        id: "directions",
        icon: <IconCompass />,
        label: "Propose three directions for the next iteration",
        meta: "team-lead",
      },
      {
        id: "status",
        icon: <IconReport />,
        label: "Draft a status report for Friday",
        meta: "reports",
      },
      {
        id: "spec-review",
        icon: <IconSpec />,
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

function IconSummary() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d="M3 4h8" />
      <path d="M3 7h8" />
      <path d="M3 10h5" />
    </svg>
  );
}

function IconCompass() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="7" cy="7" r="5" />
      <path d="M9 5L7.5 8.5 5 10l1.5-3.5z" />
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

function IconSpec() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round">
      <path d="M4 2.5h6l2 2v7H4z" />
      <path d="M6 6h4" />
      <path d="M6 8.5h2.5" />
    </svg>
  );
}
