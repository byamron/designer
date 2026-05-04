import { useMemo, useState } from "react";
import { Archive, RotateCcw, Trash2 } from "lucide-react";
import type { Project, WorkspaceSummary } from "../ipc/types";
import { ipcClient } from "../ipc/client";
import { refreshWorkspaces, useDataState } from "../store/data";
import { emptyArray } from "../util/empty";
import { IconButton } from "../components/IconButton";
import { TabLayout } from "../layout/TabLayout";

/**
 * Archived workspaces page — the destination for the sidebar's Archived
 * tab. Lists every archived workspace in the active project and exposes
 * the same Restore / Delete affordances that used to live in the
 * collapsible sidebar section.
 */
export function ArchivedView({ project }: { project: Project }) {
  const workspaces = useDataState((s) => s.workspaces);
  const projectWorkspaces: WorkspaceSummary[] =
    workspaces[project.id] ?? emptyArray();
  const archived = useMemo(
    () => projectWorkspaces.filter((w) => w.workspace.state === "archived"),
    [projectWorkspaces],
  );

  return (
    <TabLayout>
      <div className="home-a">
        <header className="archived-view__head">
          <Archive size={20} strokeWidth={1.5} aria-hidden="true" />
          <div>
            <h2 className="archived-view__title">Archived workspaces</h2>
            <p className="archived-view__subtitle">
              {archived.length === 0
                ? "Nothing archived yet — archived workspaces will appear here."
                : `${archived.length} archived workspace${archived.length === 1 ? "" : "s"} in ${project.name}.`}
            </p>
          </div>
        </header>

        {archived.length > 0 && (
          <ul className="archived-view__list" role="list">
            {archived.map((summary) => (
              <ArchivedRow
                key={summary.workspace.id}
                summary={summary}
                projectId={project.id}
              />
            ))}
          </ul>
        )}
      </div>
    </TabLayout>
  );
}

function ArchivedRow({
  summary,
  projectId,
}: {
  summary: WorkspaceSummary;
  projectId: string;
}) {
  const [busy, setBusy] = useState(false);
  const workspace = summary.workspace;

  const onRestore = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await ipcClient().restoreWorkspace(workspace.id);
      await refreshWorkspaces(projectId);
    } catch (err) {
      console.error("restore_workspace failed", err);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = async () => {
    if (busy) return;
    const ok = window.confirm(
      `Permanently delete '${workspace.name}'? Its chat will no longer be accessible.`,
    );
    if (!ok) return;
    setBusy(true);
    try {
      await ipcClient().deleteWorkspace(workspace.id);
      await refreshWorkspaces(projectId);
    } catch (err) {
      console.error("delete_workspace failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="archived-view__row">
      <span className="archived-view__row-title">{workspace.name}</span>
      <span className="archived-view__row-meta">{workspace.base_branch}</span>
      <span className="archived-view__row-actions">
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
