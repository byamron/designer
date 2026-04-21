// Deterministic mock core. Mirrors the Rust `AppCore` closely enough that UI
// behavior stays faithful when running in the browser without Tauri. Seeded
// with recognizable demo data so the first-run experience is substantial.

import type {
  CreateProjectRequest,
  CreateWorkspaceRequest,
  OpenTabRequest,
  Project,
  ProjectId,
  ProjectSummary,
  SpineRow,
  StreamEvent,
  Tab,
  TabTemplate,
  Workspace,
  WorkspaceId,
  WorkspaceSummary,
} from "./types";

type Listener = (event: StreamEvent) => void;
interface Approval {
  id: string;
  workspaceId: WorkspaceId;
  gate: string;
  summary: string;
  status: "pending" | "granted" | "denied";
}

export interface MockCore {
  listProjects(): ProjectSummary[];
  createProject(req: CreateProjectRequest): ProjectSummary;
  listWorkspaces(id: ProjectId): WorkspaceSummary[];
  createWorkspace(req: CreateWorkspaceRequest): WorkspaceSummary;
  openTab(req: OpenTabRequest): Tab;
  spine(id: WorkspaceId | null): SpineRow[];
  subscribe(h: Listener): () => void;
  requestApproval(workspaceId: WorkspaceId, gate: string, summary: string): string;
  resolveApproval(id: string, granted: boolean, reason?: string): void;
  approvals(): Approval[];
}

function uuid(): string {
  return crypto.randomUUID();
}

function now(): string {
  return new Date().toISOString();
}

export function createMockCore(): MockCore {
  const projects: Project[] = [];
  const workspaces: Workspace[] = [];
  const listeners = new Set<Listener>();
  const approvals: Approval[] = [];
  let sequence = 0;
  const emit = (event: Omit<StreamEvent, "sequence">) => {
    const payload: StreamEvent = { ...event, sequence: ++sequence };
    for (const l of listeners) l(payload);
  };

  // Seed recognizable demo data so empty-state design still has body.
  const designerProject: Project = {
    id: uuid(),
    name: "Designer",
    root_path: "/Users/you/code/designer",
    created_at: now(),
    archived_at: null,
    autonomy: "suggest",
  };
  projects.push(designerProject);
  const playgroundProject: Project = {
    id: uuid(),
    name: "Playground",
    root_path: "/Users/you/code/playground",
    created_at: now(),
    archived_at: null,
    autonomy: "suggest",
  };
  projects.push(playgroundProject);

  const onboarding: Workspace = {
    id: uuid(),
    project_id: designerProject.id,
    name: "onboarding",
    state: "active",
    base_branch: "main",
    worktree_path: null,
    created_at: now(),
    tabs: [
      { id: uuid(), title: "Plan", template: "plan", created_at: now(), closed_at: null },
      { id: uuid(), title: "Design", template: "design", created_at: now(), closed_at: null },
    ],
  };
  workspaces.push(onboarding);

  const activitySpine: Workspace = {
    id: uuid(),
    project_id: designerProject.id,
    name: "activity-spine",
    state: "paused",
    base_branch: "main",
    worktree_path: null,
    created_at: now(),
    tabs: [],
  };
  workspaces.push(activitySpine);

  const listProjects = (): ProjectSummary[] =>
    projects.map((p) => ({
      project: p,
      workspace_count: workspaces.filter((w) => w.project_id === p.id).length,
    }));

  const listWorkspaces = (id: ProjectId): WorkspaceSummary[] =>
    workspaces
      .filter((w) => w.project_id === id)
      .map((w) => ({
        workspace: w,
        state: w.state,
        agent_count: 0,
      }));

  const spineFor = (id: WorkspaceId | null): SpineRow[] => {
    if (!id) {
      return listProjects().map((p) => ({
        id: p.project.id,
        altitude: "project",
        label: p.project.name,
        summary: `${p.workspace_count} workspace${p.workspace_count === 1 ? "" : "s"}`,
        state: "idle",
        children: [],
      }));
    }
    const w = workspaces.find((w) => w.id === id);
    if (!w) return [];
    return [
      {
        id: `${w.id}-lead`,
        altitude: "agent",
        label: "team-lead",
        summary: w.state === "active" ? "reviewing plan" : "idle",
        state: w.state === "active" ? "active" : "idle",
        children: [
          {
            id: `${w.id}-lead-tool-1`,
            altitude: "artifact",
            label: "editing core-docs/plan.md",
            summary: null,
            state: "active",
            children: [],
          },
        ],
      },
      {
        id: `${w.id}-design`,
        altitude: "agent",
        label: "design-reviewer",
        summary: "waiting on plan",
        state: "idle",
        children: [],
      },
      {
        id: `${w.id}-tests`,
        altitude: "agent",
        label: "test-runner",
        summary: "ready",
        state: "idle",
        children: [],
      },
    ];
  };

  return {
    listProjects,
    listWorkspaces,
    createProject(req) {
      const project: Project = {
        id: uuid(),
        name: req.name,
        root_path: req.root_path,
        created_at: now(),
        archived_at: null,
        autonomy: "suggest",
      };
      projects.push(project);
      emit({
        kind: "project_created",
        stream_id: project.id,
        timestamp: now(),
        summary: `Project '${project.name}' created`,
      });
      return { project, workspace_count: 0 };
    },
    createWorkspace(req) {
      const workspace: Workspace = {
        id: uuid(),
        project_id: req.project_id,
        name: req.name,
        state: "active",
        base_branch: req.base_branch,
        worktree_path: null,
        created_at: now(),
        tabs: [],
      };
      workspaces.push(workspace);
      emit({
        kind: "workspace_created",
        stream_id: workspace.id,
        timestamp: now(),
        summary: `Workspace '${workspace.name}' created`,
      });
      return { workspace, state: workspace.state, agent_count: 0 };
    },
    openTab(req) {
      const tab: Tab = {
        id: uuid(),
        title: req.title,
        template: req.template,
        created_at: now(),
        closed_at: null,
      };
      const w = workspaces.find((w) => w.id === req.workspace_id);
      if (w) w.tabs.push(tab);
      emit({
        kind: "tab_opened",
        stream_id: req.workspace_id,
        timestamp: now(),
        summary: `Tab '${tab.title}' (${tab.template}) opened`,
      });
      return tab;
    },
    spine: spineFor,
    subscribe(handler) {
      listeners.add(handler);
      return () => listeners.delete(handler);
    },
    requestApproval(workspaceId, gate, summary) {
      const approval: Approval = {
        id: uuid(),
        workspaceId,
        gate,
        summary,
        status: "pending",
      };
      approvals.push(approval);
      emit({
        kind: "approval_requested",
        stream_id: workspaceId,
        timestamp: now(),
        summary: `Approval requested: ${gate}`,
      });
      return approval.id;
    },
    resolveApproval(id, granted, reason) {
      const a = approvals.find((a) => a.id === id);
      if (!a) return;
      a.status = granted ? "granted" : "denied";
      emit({
        kind: granted ? "approval_granted" : "approval_denied",
        stream_id: a.workspaceId,
        timestamp: now(),
        summary: reason ?? (granted ? "Granted" : "Denied"),
      });
    },
    approvals() {
      return [...approvals];
    },
  };
}

/** Expose some fields tests use to preseed or inspect state. */
export type { TabTemplate };
