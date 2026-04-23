import {
  AlertTriangle,
  Check,
  Circle,
  Eye,
  GitMerge,
  GitPullRequest,
  LoaderCircle,
} from "lucide-react";
import type { WorkspaceStatus } from "../ipc/types";

/**
 * Single source of truth for the 7-variant workspace status glyph.
 * Used by the WorkspaceSidebar rows and HomeTabA's Active-workspaces
 * section so "status" reads the same across every surface.
 */

const LABEL: Record<WorkspaceStatus, string> = {
  idle: "Idle",
  in_progress: "In progress",
  in_review: "In review",
  pr_open: "PR open",
  pr_conflict: "PR has conflicts",
  pr_ready: "PR ready to merge",
  pr_merged: "PR merged",
};

export function WorkspaceStatusIcon({ status }: { status: WorkspaceStatus }) {
  const label = LABEL[status];
  return (
    <span
      className="workspace-status"
      data-status={status}
      aria-label={label}
      title={label}
    >
      {renderGlyph(status)}
    </span>
  );
}

function renderGlyph(status: WorkspaceStatus) {
  const common = { size: 12, strokeWidth: 1.5, "aria-hidden": true as const };
  switch (status) {
    case "idle":
      return <Circle {...common} />;
    case "in_progress":
      return <LoaderCircle {...common} />;
    case "in_review":
      return <Eye {...common} />;
    case "pr_open":
      return <GitPullRequest {...common} />;
    case "pr_conflict":
      return <AlertTriangle {...common} />;
    case "pr_ready":
      return <Check {...common} />;
    case "pr_merged":
      return <GitMerge {...common} />;
  }
}
