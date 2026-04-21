// Humanize event kind strings for display. Keeps the manager-cockpit register
// instead of exposing snake_case identifiers.

const LABELS: Record<string, string> = {
  project_created: "Project created",
  project_renamed: "Project renamed",
  project_archived: "Project archived",
  workspace_created: "Workspace created",
  workspace_state_changed: "Workspace state changed",
  workspace_worktree_attached: "Worktree attached",
  tab_opened: "Tab opened",
  tab_renamed: "Tab renamed",
  tab_closed: "Tab closed",
  agent_spawned: "Agent joined",
  agent_idled: "Agent idle",
  agent_errored: "Agent errored",
  task_created: "Task created",
  task_updated: "Task updated",
  task_completed: "Task completed",
  message_posted: "Message",
  project_thread_posted: "Project thread",
  approval_requested: "Approval requested",
  approval_granted: "Approval granted",
  approval_denied: "Approval denied",
  cost_recorded: "Cost recorded",
  scope_denied: "Scope denied",
  audit_entry: "Audit entry",
  auditor_flagged: "Auditor flag",
};

export function humanizeKind(kind: string): string {
  if (LABELS[kind]) return LABELS[kind];
  // Fallback: snake_case → Title Case with spaces
  return kind
    .split("_")
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1))
    .join(" ");
}
