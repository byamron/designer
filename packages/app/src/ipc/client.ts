// Typed IPC client. Under Tauri, delegates to the runtime adapter in ./tauri.
// In a browser (dev, tests), delegates to the in-memory mock so the surface is
// exercisable without the WebView. Callers never know which runtime they're on.

import type {
  ArtifactDetail,
  ArtifactId,
  ArtifactSummary,
  CreateProjectRequest,
  CreateWorkspaceRequest,
  LinkRepoRequest,
  OpenTabRequest,
  ProjectId,
  ProjectSummary,
  RequestMergeRequest,
  SpineRow,
  StartTrackRequest,
  Tab,
  TabId,
  TrackId,
  TrackSummary,
  WorkspaceId,
  WorkspaceSummary,
  StreamEvent,
} from "./types";
import { createMockCore, type MockCore } from "./mock";
import { invoke, isTauri, listen } from "./tauri";

export interface IpcClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(req: CreateProjectRequest): Promise<ProjectSummary>;
  listWorkspaces(id: ProjectId): Promise<WorkspaceSummary[]>;
  createWorkspace(req: CreateWorkspaceRequest): Promise<WorkspaceSummary>;
  openTab(req: OpenTabRequest): Promise<Tab>;
  closeTab(workspaceId: WorkspaceId, tabId: TabId): Promise<void>;
  spine(id: WorkspaceId | null): Promise<SpineRow[]>;
  stream(handler: (event: StreamEvent) => void): () => void;
  requestApproval(
    workspaceId: WorkspaceId,
    gate: string,
    summary: string,
  ): Promise<string>;
  resolveApproval(id: string, granted: boolean, reason?: string): Promise<void>;
  // Artifacts (Phase 13.1)
  listArtifacts(workspaceId: WorkspaceId): Promise<ArtifactSummary[]>;
  listPinnedArtifacts(workspaceId: WorkspaceId): Promise<ArtifactSummary[]>;
  getArtifact(id: ArtifactId): Promise<ArtifactDetail>;
  togglePinArtifact(id: ArtifactId): Promise<boolean>;
  // Track + git wire (Phase 13.E)
  linkRepo(req: LinkRepoRequest): Promise<void>;
  startTrack(req: StartTrackRequest): Promise<TrackId>;
  requestMerge(req: RequestMergeRequest): Promise<number>;
  listTracks(workspaceId: WorkspaceId): Promise<TrackSummary[]>;
  getTrack(id: TrackId): Promise<TrackSummary>;
}

export const EVENT_STREAM_CHANNEL = "designer://event-stream";

class TauriIpcClient implements IpcClient {
  listProjects() {
    return invoke<ProjectSummary[]>("list_projects");
  }
  createProject(req: CreateProjectRequest) {
    return invoke<ProjectSummary>("create_project", { req });
  }
  listWorkspaces(id: ProjectId) {
    return invoke<WorkspaceSummary[]>("list_workspaces", { projectId: id });
  }
  createWorkspace(req: CreateWorkspaceRequest) {
    return invoke<WorkspaceSummary>("create_workspace", { req });
  }
  openTab(req: OpenTabRequest) {
    return invoke<Tab>("open_tab", { req });
  }
  closeTab(workspaceId: WorkspaceId, tabId: TabId) {
    return invoke<void>("close_tab", { workspaceId, tabId });
  }
  spine(id: WorkspaceId | null) {
    return invoke<SpineRow[]>("spine", { workspaceId: id });
  }
  stream(handler: (event: StreamEvent) => void) {
    return listen<StreamEvent>(EVENT_STREAM_CHANNEL, handler);
  }
  requestApproval(workspaceId: WorkspaceId, gate: string, summary: string) {
    return invoke<string>("request_approval", { workspaceId, gate, summary });
  }
  resolveApproval(id: string, granted: boolean, reason?: string) {
    return invoke<void>("resolve_approval", { id, granted, reason });
  }
  listArtifacts(workspaceId: WorkspaceId) {
    return invoke<ArtifactSummary[]>("list_artifacts", { workspaceId });
  }
  listPinnedArtifacts(workspaceId: WorkspaceId) {
    return invoke<ArtifactSummary[]>("list_pinned_artifacts", { workspaceId });
  }
  getArtifact(id: ArtifactId) {
    return invoke<ArtifactDetail>("get_artifact", { artifactId: id });
  }
  togglePinArtifact(id: ArtifactId) {
    return invoke<boolean>("toggle_pin_artifact", { req: { artifact_id: id } });
  }
  linkRepo(req: LinkRepoRequest) {
    return invoke<void>("cmd_link_repo", { req });
  }
  startTrack(req: StartTrackRequest) {
    return invoke<TrackId>("cmd_start_track", { req });
  }
  requestMerge(req: RequestMergeRequest) {
    return invoke<number>("cmd_request_merge", { req });
  }
  listTracks(workspaceId: WorkspaceId) {
    return invoke<TrackSummary[]>("cmd_list_tracks", { workspaceId });
  }
  getTrack(id: TrackId) {
    return invoke<TrackSummary>("cmd_get_track", { trackId: id });
  }
}

class MockIpcClient implements IpcClient {
  constructor(private readonly core: MockCore) {}
  listProjects() {
    return Promise.resolve(this.core.listProjects());
  }
  createProject(req: CreateProjectRequest) {
    return Promise.resolve(this.core.createProject(req));
  }
  listWorkspaces(id: ProjectId) {
    return Promise.resolve(this.core.listWorkspaces(id));
  }
  createWorkspace(req: CreateWorkspaceRequest) {
    return Promise.resolve(this.core.createWorkspace(req));
  }
  openTab(req: OpenTabRequest) {
    return Promise.resolve(this.core.openTab(req));
  }
  closeTab(workspaceId: WorkspaceId, tabId: TabId) {
    this.core.closeTab(workspaceId, tabId);
    return Promise.resolve();
  }
  spine(id: WorkspaceId | null) {
    return Promise.resolve(this.core.spine(id));
  }
  stream(handler: (event: StreamEvent) => void) {
    return this.core.subscribe(handler);
  }
  requestApproval(workspaceId: WorkspaceId, gate: string, summary: string) {
    return Promise.resolve(this.core.requestApproval(workspaceId, gate, summary));
  }
  resolveApproval(id: string, granted: boolean, reason?: string) {
    this.core.resolveApproval(id, granted, reason);
    return Promise.resolve();
  }
  listArtifacts(workspaceId: WorkspaceId) {
    return Promise.resolve(this.core.listArtifacts(workspaceId));
  }
  listPinnedArtifacts(workspaceId: WorkspaceId) {
    return Promise.resolve(this.core.listPinnedArtifacts(workspaceId));
  }
  getArtifact(id: ArtifactId) {
    return Promise.resolve(this.core.getArtifact(id));
  }
  togglePinArtifact(id: ArtifactId) {
    return Promise.resolve(this.core.togglePinArtifact(id));
  }
  linkRepo(req: LinkRepoRequest) {
    return Promise.resolve(this.core.linkRepo(req));
  }
  startTrack(req: StartTrackRequest) {
    return Promise.resolve(this.core.startTrack(req));
  }
  requestMerge(req: RequestMergeRequest) {
    return Promise.resolve(this.core.requestMerge(req));
  }
  listTracks(workspaceId: WorkspaceId) {
    return Promise.resolve(this.core.listTracks(workspaceId));
  }
  getTrack(id: TrackId) {
    return Promise.resolve(this.core.getTrack(id));
  }
}

let singleton: IpcClient | null = null;
export function ipcClient(): IpcClient {
  if (singleton) return singleton;
  singleton = isTauri() ? new TauriIpcClient() : new MockIpcClient(createMockCore());
  return singleton;
}

/** Testing: swap in an explicit client (e.g. the mock with seed data). */
export function __setIpcClient(client: IpcClient) {
  singleton = client;
}
