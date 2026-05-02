// Deterministic mock core. Mirrors the Rust `AppCore` closely enough that UI
// behavior stays faithful when running in the browser without Tauri. Seeded
// with recognizable demo data so the first-run experience is substantial.

import type {
  ArtifactDetail,
  ArtifactId,
  ArtifactKind,
  ArtifactSummary,
  CreateProjectRequest,
  CreateWorkspaceRequest,
  LinkRepoRequest,
  OpenTabRequest,
  PayloadRef,
  PostMessageRequest,
  PostMessageResponse,
  Project,
  ProjectId,
  ProjectSummary,
  RequestMergeRequest,
  SpineRow,
  StartTrackRequest,
  StreamEvent,
  Tab,
  TabId,
  TabTemplate,
  TrackId,
  TrackState,
  TrackSummary,
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
  closeTab(workspaceId: WorkspaceId, tabId: TabId): void;
  spine(id: WorkspaceId | null): SpineRow[];
  subscribe(h: Listener): () => void;
  requestApproval(workspaceId: WorkspaceId, gate: string, summary: string): string;
  resolveApproval(id: string, granted: boolean, reason?: string): void;
  approvals(): Approval[];
  // Phase 13.1
  listArtifacts(workspaceId: WorkspaceId): ArtifactSummary[];
  /** Per-tab thread view (per-tab thread isolation). Returns
   *  workspace-wide artifacts plus only the messages for `tabId`. */
  listArtifactsInTab(
    workspaceId: WorkspaceId,
    tabId: TabId,
  ): ArtifactSummary[];
  listPinnedArtifacts(workspaceId: WorkspaceId): ArtifactSummary[];
  getArtifact(id: ArtifactId): ArtifactDetail;
  togglePinArtifact(id: ArtifactId): boolean;
  // Phase 13.D
  postMessage(req: PostMessageRequest): PostMessageResponse;
  /** Test surface: every postMessage call captured for assertion. */
  postedMessages(): PostMessageRequest[];
  // Phase 13.E
  linkRepo(req: LinkRepoRequest): void;
  startTrack(req: StartTrackRequest): TrackId;
  requestMerge(req: RequestMergeRequest): number;
  listTracks(workspaceId: WorkspaceId): TrackSummary[];
  getTrack(id: TrackId): TrackSummary;
}

interface MockArtifact extends ArtifactSummary {
  payload: PayloadRef;
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
  const tracks: TrackSummary[] = [];
  const listeners = new Set<Listener>();
  const approvals: Approval[] = [];
  const postedMessages: PostMessageRequest[] = [];
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
    status: "in_progress",
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
    status: "pr_open",
    base_branch: "main",
    worktree_path: null,
    created_at: now(),
    tabs: [],
  };
  workspaces.push(activitySpine);

  // Seed demo artifacts so first-run shows what block renderers produce.
  const artifacts: MockArtifact[] = [];
  const makeArtifact = (
    workspaceId: WorkspaceId,
    kind: ArtifactKind,
    title: string,
    summary: string,
    body: string,
    options: { pinned?: boolean; authorRole?: string | null } = {},
  ): MockArtifact => {
    const id = uuid();
    const ts = now();
    return {
      id,
      workspace_id: workspaceId,
      kind,
      title,
      summary,
      author_role: options.authorRole ?? null,
      version: 1,
      created_at: ts,
      updated_at: ts,
      pinned: options.pinned ?? false,
      payload: { kind: "inline", body },
    };
  };
  artifacts.push(
    makeArtifact(
      onboarding.id,
      "spec",
      "Onboarding spec",
      "Three-step repo link + autonomy choice; skip for experimentation.",
      "**Goal.** First-run user can link a repo and spawn a workspace in under 60 seconds.\n\n**States.** not-linked → linking → linked.\n\n**Surfaces.** onboarding overlay, workspace strip.",
      { pinned: true, authorRole: "team-lead" },
    ),
  );
  artifacts.push(
    makeArtifact(
      onboarding.id,
      "message",
      "Kickoff",
      "What are we building?",
      "What are we building?",
      { authorRole: "user" },
    ),
  );
  artifacts.push(
    makeArtifact(
      onboarding.id,
      "code-change",
      "Seed workspace data",
      "+142 −18 across packages/app/src/store/data.ts, ipc/mock.ts — adds demo workspace seeding.",
      "packages/app/src/store/data.ts\npackages/app/src/ipc/mock.ts",
      { authorRole: "agent" },
    ),
  );
  artifacts.push(
    makeArtifact(
      onboarding.id,
      "approval",
      "Grant git write access?",
      "Team-lead wants to commit the seed data it just generated to a scratch branch.",
      "scope: git.write\nreason: commit seed data to scratch branch",
      { authorRole: "agent" },
    ),
  );
  artifacts.push(
    makeArtifact(
      onboarding.id,
      "pr",
      "#41 — onboarding: seed demo data",
      "Open · 2 checks green · 1 pending — awaiting review.",
      "https://github.com/example/designer/pull/41",
      { pinned: true, authorRole: "agent" },
    ),
  );

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
        stream_id: `project:${project.id}`,
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
        stream_id: `workspace:${workspace.id}`,
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
        stream_id: `workspace:${req.workspace_id}`,
        timestamp: now(),
        summary: `Tab '${tab.title}' (${tab.template}) opened`,
      });
      return tab;
    },
    closeTab(workspaceId, tabId) {
      const w = workspaces.find((w) => w.id === workspaceId);
      if (!w) return;
      const t = w.tabs.find((t) => t.id === tabId);
      if (!t || t.closed_at) return;
      t.closed_at = now();
      emit({
        kind: "tab_closed",
        stream_id: `workspace:${workspaceId}`,
        timestamp: now(),
        summary: `Tab '${t.title}' closed`,
      });
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
        stream_id: `workspace:${workspaceId}`,
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
        stream_id: `workspace:${a.workspaceId}`,
        timestamp: now(),
        summary: reason ?? (granted ? "Granted" : "Denied"),
      });
    },
    approvals() {
      return [...approvals];
    },
    listArtifacts(workspaceId) {
      return artifacts
        .filter((a) => a.workspace_id === workspaceId)
        .map(({ payload: _p, ...rest }) => rest);
    },
    listArtifactsInTab(workspaceId, tabId) {
      // Per-tab thread isolation: messages live on a tab; everything
      // else stays workspace-wide. Legacy seeded messages (no tab_id)
      // attribute to the workspace's first non-closed tab so demo data
      // remains visible.
      const ws = workspaces.find((w) => w.id === workspaceId);
      const fallbackTab = ws?.tabs.find((t) => !t.closed_at)?.id ?? null;
      return artifacts
        .filter((a) => a.workspace_id === workspaceId)
        .filter((a) => {
          if (a.kind !== "message") return true;
          const owner = a.tab_id ?? fallbackTab;
          return owner === tabId;
        })
        .map(({ payload: _p, ...rest }) => rest);
    },
    listPinnedArtifacts(workspaceId) {
      return artifacts
        .filter((a) => a.workspace_id === workspaceId && a.pinned)
        .map(({ payload: _p, ...rest }) => rest);
    },
    getArtifact(id) {
      const a = artifacts.find((a) => a.id === id);
      if (!a) throw new Error(`artifact not found: ${id}`);
      const { payload, ...summary } = a;
      return { summary, payload };
    },
    togglePinArtifact(id) {
      const a = artifacts.find((a) => a.id === id);
      if (!a) return false;
      a.pinned = !a.pinned;
      emit({
        kind: a.pinned ? "artifact_pinned" : "artifact_unpinned",
        stream_id: `workspace:${a.workspace_id}`,
        timestamp: now(),
        summary: `${a.pinned ? "Pinned" : "Unpinned"} ${a.title}`,
      });
      return a.pinned;
    },
    postMessage(req) {
      postedMessages.push(req);
      // Mirror the Rust path: the user message lands as a Message
      // artifact synchronously, then the mock simulates an agent reply
      // (and an optional diagram/report when the prompt mentions one)
      // so the thread visibly progresses without a real subprocess.
      // Per-tab isolation: both the user message and the reply are
      // attributed to the active tab (when one is provided).
      const tabId: TabId | null = req.tab_id ?? null;
      const userArtifact: MockArtifact = {
        id: uuid(),
        workspace_id: req.workspace_id,
        kind: "message",
        title: firstLineTruncate(req.text, 60),
        summary: firstLineTruncate(req.text, 140),
        author_role: "user",
        version: 1,
        created_at: now(),
        updated_at: now(),
        pinned: false,
        payload: { kind: "inline", body: req.text },
        tab_id: tabId,
      };
      artifacts.push(userArtifact);
      emit({
        kind: "artifact_created",
        stream_id: `workspace:${req.workspace_id}`,
        timestamp: now(),
        summary: userArtifact.title,
      });

      const reply = `Acknowledged: ${req.text}`;
      const replyArtifact: MockArtifact = {
        id: uuid(),
        workspace_id: req.workspace_id,
        kind: "message",
        title: firstLineTruncate(reply, 60),
        summary: firstLineTruncate(reply, 140),
        author_role: "team-lead",
        version: 1,
        created_at: now(),
        updated_at: now(),
        pinned: false,
        payload: { kind: "inline", body: reply },
        tab_id: tabId,
      };
      artifacts.push(replyArtifact);
      emit({
        kind: "artifact_created",
        stream_id: `workspace:${req.workspace_id}`,
        timestamp: now(),
        summary: replyArtifact.title,
      });

      const lower = req.text.toLowerCase();
      if (lower.includes("diagram") || lower.includes("report")) {
        const isDiagram = lower.includes("diagram");
        const extra: MockArtifact = {
          id: uuid(),
          workspace_id: req.workspace_id,
          kind: isDiagram ? "diagram" : "report",
          title: isDiagram ? "Sequence diagram" : "Activity report",
          summary: isDiagram
            ? "Mock diagram produced from the prompt."
            : "Mock report produced from the prompt.",
          author_role: "team-lead",
          version: 1,
          created_at: now(),
          updated_at: now(),
          pinned: false,
          payload: { kind: "inline", body: reply },
        };
        artifacts.push(extra);
        emit({
          kind: "artifact_created",
          stream_id: `workspace:${req.workspace_id}`,
          timestamp: now(),
          summary: extra.title,
        });
      }
      return { artifact_id: userArtifact.id };
    },
    postedMessages() {
      return [...postedMessages];
    },
    linkRepo(req) {
      const w = workspaces.find((w) => w.id === req.workspace_id);
      if (!w) throw new Error(`workspace not found: ${req.workspace_id}`);
      if (!req.repo_path || req.repo_path.trim().length === 0) {
        throw new Error("repo_path must not be empty");
      }
      // Mock validation: any path that doesn't start with `/` is invalid.
      if (!req.repo_path.startsWith("/")) {
        throw new Error(`not a git repository: ${req.repo_path}`);
      }
      w.worktree_path = req.repo_path;
      emit({
        kind: "workspace_worktree_attached",
        stream_id: w.id,
        timestamp: now(),
        summary: `Linked ${req.repo_path}`,
      });
    },
    startTrack(req) {
      const w = workspaces.find((w) => w.id === req.workspace_id);
      if (!w) throw new Error(`workspace not found: ${req.workspace_id}`);
      if (!w.worktree_path) {
        throw new Error(`repo not linked: ${req.workspace_id}`);
      }
      const id = uuid();
      const ts = now();
      const track: TrackSummary = {
        id,
        workspace_id: w.id,
        branch: req.branch,
        worktree_path: `${w.worktree_path}/.designer/worktrees/${id}-${req.branch}`,
        state: "active" as TrackState,
        pr_number: null,
        pr_url: null,
        created_at: ts,
        completed_at: null,
        archived_at: null,
      };
      tracks.push(track);
      emit({
        kind: "track_started",
        stream_id: w.id,
        timestamp: ts,
        summary: `Track started on ${req.branch}`,
      });
      return id;
    },
    requestMerge(req) {
      const t = tracks.find((t) => t.id === req.track_id);
      if (!t) throw new Error(`track not found: ${req.track_id}`);
      if (t.state !== "active" && t.state !== "requesting_merge") {
        throw new Error(`track ${t.id} is not in a mergeable state (${t.state})`);
      }
      const number = 100 + tracks.indexOf(t);
      t.pr_number = number;
      t.pr_url = `https://github.com/example/designer/pull/${number}`;
      t.state = "pr_open";
      emit({
        kind: "pull_request_opened",
        stream_id: t.workspace_id,
        timestamp: now(),
        summary: `PR #${number} opened`,
      });
      return number;
    },
    listTracks(workspaceId) {
      return tracks.filter((t) => t.workspace_id === workspaceId);
    },
    getTrack(id) {
      const t = tracks.find((t) => t.id === id);
      if (!t) throw new Error(`track not found: ${id}`);
      return t;
    },
  };
}

function firstLineTruncate(s: string, max: number): string {
  const first = s.split("\n").find((l) => l.trim().length > 0)?.trim() ?? s.trim();
  if (first.length <= max) return first;
  return first.slice(0, max) + "…";
}

/** Expose some fields tests use to preseed or inspect state. */
export type { TabTemplate };
