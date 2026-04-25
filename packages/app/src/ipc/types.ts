// Shared IPC types. Kept in sync with `crates/designer-ipc/src/lib.rs`.
// When drift matters, run a `ts-rs` codegen step (Phase 8 addendum).

export type ProjectId = string;
export type WorkspaceId = string;
export type TabId = string;

export type Autonomy = "suggest" | "act" | "scheduled";

export type WorkspaceState = "active" | "paused" | "archived" | "errored";

// Work-progression status, orthogonal to WorkspaceState (lifecycle).
// A workspace can be "active" (lifecycle) and "in_review" (status) at once.
export type WorkspaceStatus =
  | "idle"
  | "in_progress"
  | "in_review"
  | "pr_open"
  | "pr_conflict"
  | "pr_ready"
  | "pr_merged";

// Post-13.1 every tab renders the unified WorkspaceThread. Legacy values
// (`plan`, `design`, `build`, `blank`) are preserved for replay — they also
// render as threads. New tabs use `thread`.
export type TabTemplate = "thread" | "plan" | "design" | "build" | "blank";

// ---- Artifacts (Phase 13.1) ----
export type ArtifactId = string;

export type ArtifactKind =
  | "message"
  | "spec"
  | "code-change"
  | "pr"
  | "approval"
  | "report"
  | "prototype"
  | "comment"
  | "task-list"
  | "diagram"
  | "variant"
  | "track-rollup";

export type PayloadRef =
  | { kind: "inline"; body: string }
  | { kind: "hash"; hash: string; size: number };

export interface ArtifactSummary {
  id: ArtifactId;
  workspace_id: WorkspaceId;
  kind: ArtifactKind;
  title: string;
  summary: string;
  author_role: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  pinned: boolean;
}

export interface ArtifactDetail {
  summary: ArtifactSummary;
  payload: PayloadRef;
}

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
  status?: WorkspaceStatus;
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

// Phase 13.G safety surfaces — re-exported from `./client` for convenience
// so `import type { KeychainStatus } from "../ipc/types"` works without
// pulling in the runtime client module.
export type {
  CostChipPreferences,
  CostStatus,
  KeychainStatus,
  PendingApproval,
} from "./client";
