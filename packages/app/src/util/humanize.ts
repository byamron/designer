// Humanize event kind strings for display. Keeps the manager-cockpit register
// instead of exposing snake_case identifiers.

const LABELS: Record<string, string> = {
  project_created: "Project created",
  project_renamed: "Project renamed",
  project_archived: "Project archived",
  workspace_created: "Workspace created",
  workspace_state_changed: "Workspace state changed",
  workspace_worktree_attached: "Worktree attached",
  workspace_deleted: "Workspace deleted",
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

/** Map a backend role string (snake_case, lowercase) onto the display
 *  name the user sees in chat. The cockpit register treats agents as
 *  named teammates, not opaque process labels — `team-lead` reads as
 *  "Team Lead", not "team-lead". Unknown roles fall through with a
 *  best-effort title-case so we never expose `team_lead_agent`-style
 *  identifiers to the user. */
const ROLE_LABELS: Record<string, string> = {
  user: "You",
  you: "You",
  agent: "Designer",
  assistant: "Designer",
  "team-lead": "Team Lead",
  team_lead: "Team Lead",
  planner: "Planner",
  designer: "Designer",
  "rust-core": "Rust Core",
  "claude-integration": "Claude",
  "swift-helper": "Swift Helper",
  "git-ops": "Git Ops",
  "local-models": "Local Models",
  safety: "Safety",
  frontend: "Frontend",
  docs: "Docs",
};

export function humanizeRole(role: string | null | undefined): string {
  if (!role) return "Designer";
  const key = role.toLowerCase();
  if (ROLE_LABELS[key]) return ROLE_LABELS[key];
  // Strip a trailing "_agent" / "-agent" qualifier (the backend
  // sometimes appends it for stream identifiers).
  const stripped = key.replace(/[-_]agent$/, "");
  if (ROLE_LABELS[stripped]) return ROLE_LABELS[stripped];
  // Title-case fallback: "team_lead" → "Team Lead".
  return stripped
    .split(/[-_]/)
    .filter(Boolean)
    .map((w) => (w[0]?.toUpperCase() ?? "") + w.slice(1))
    .join(" ");
}
