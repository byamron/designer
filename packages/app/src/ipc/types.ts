// Shared IPC types. Kept in sync with `crates/designer-ipc/src/lib.rs`.
// When drift matters, run a `ts-rs` codegen step (Phase 8 addendum).

export type ProjectId = string;
export type WorkspaceId = string;
export type TabId = string;

export type Autonomy = "suggest" | "act" | "scheduled";

export type WorkspaceState = "active" | "paused" | "archived" | "errored";

export type TabTemplate = "plan" | "design" | "build" | "blank";

export type SpineState =
  | "active"
  | "idle"
  | "blocked"
  | "needs_you"
  | "errored";

export type SpineAltitude = "project" | "workspace" | "agent" | "artifact";

export interface Project {
  id: ProjectId;
  name: string;
  root_path: string;
  created_at: string;
  archived_at: string | null;
  autonomy: Autonomy;
}

export interface Tab {
  id: TabId;
  title: string;
  template: TabTemplate;
  created_at: string;
  closed_at: string | null;
}

export interface Workspace {
  id: WorkspaceId;
  project_id: ProjectId;
  name: string;
  state: WorkspaceState;
  base_branch: string;
  worktree_path: string | null;
  created_at: string;
  tabs: Tab[];
}

export interface ProjectSummary {
  project: Project;
  workspace_count: number;
}

export interface WorkspaceSummary {
  workspace: Workspace;
  state: WorkspaceState;
  agent_count: number;
}

export interface SpineRow {
  id: string;
  altitude: SpineAltitude;
  label: string;
  summary: string | null;
  state: SpineState;
  children: SpineRow[];
}

export interface CreateProjectRequest {
  name: string;
  root_path: string;
}

export interface CreateWorkspaceRequest {
  project_id: ProjectId;
  name: string;
  base_branch: string;
}

export interface OpenTabRequest {
  workspace_id: WorkspaceId;
  title: string;
  template: TabTemplate;
}

export interface StreamEvent {
  kind: string;
  stream_id: string;
  sequence: number;
  timestamp: string;
  summary?: string;
  payload?: unknown;
}

export type AttentionTier = "inline" | "ambient" | "notify" | "digest";
