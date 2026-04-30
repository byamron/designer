// Typed IPC client. Under Tauri, delegates to the runtime adapter in ./tauri.
// In a browser (dev, tests), delegates to the in-memory mock so the surface is
// exercisable without the WebView. Callers never know which runtime they're on.

import type {
  AddressFrictionRequest,
  ArtifactDetail,
  ArtifactId,
  ArtifactSummary,
  CreateProjectRequest,
  CreateWorkspaceRequest,
  FindingDto,
  FrictionEntry,
  FrictionTransitionRequest,
  LinkRepoRequest,
  ListProposalsRequest,
  OpenTabRequest,
  PostMessageRequest,
  PostMessageResponse,
  ProjectId,
  ProjectSummary,
  ProposalDto,
  ReportFrictionRequest,
  ReportFrictionResponse,
  RequestMergeRequest,
  ResolveProposalRequest,
  SignalFindingRequest,
  SignalProposalRequest,
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
  // Agent wire (Phase 13.D)
  postMessage(req: PostMessageRequest): Promise<PostMessageResponse>;
  // Track + git wire (Phase 13.E)
  linkRepo(req: LinkRepoRequest): Promise<void>;
  startTrack(req: StartTrackRequest): Promise<TrackId>;
  requestMerge(req: RequestMergeRequest): Promise<number>;
  listTracks(workspaceId: WorkspaceId): Promise<TrackSummary[]>;
  getTrack(id: TrackId): Promise<TrackSummary>;
  // Safety surfaces (Phase 13.G)
  listPendingApprovals(workspaceId?: WorkspaceId): Promise<PendingApproval[]>;
  getCostStatus(workspaceId: WorkspaceId): Promise<CostStatus>;
  getKeychainStatus(): Promise<KeychainStatus>;
  getCostChipPreference(): Promise<CostChipPreferences>;
  setCostChipPreference(enabled: boolean): Promise<CostChipPreferences>;
  // Friction (Tracks 13.K + 13.L + 13.M)
  reportFriction(req: ReportFrictionRequest): Promise<ReportFrictionResponse>;
  listFriction(): Promise<FrictionEntry[]>;
  resolveFriction(req: FrictionTransitionRequest): Promise<void>;
  addressFriction(req: AddressFrictionRequest): Promise<void>;
  reopenFriction(req: FrictionTransitionRequest): Promise<void>;
  /// Capture the focused webview window's region as PNG bytes (Track 13.M).
  /// macOS-only in v1; non-macOS hosts reject with a clear message.
  captureViewport(): Promise<Uint8Array>;
  /// Reveal `path` in Finder (macOS) — selects the file. Falls back to a
  /// clipboard copy when the Tauri runtime isn't available so the user
  /// can paste the path into a Finder "Go to Folder" prompt.
  revealInFinder(path: string): Promise<void>;
  // Learning layer (Phase 21.A1)
  listFindings(projectId: ProjectId): Promise<FindingDto[]>;
  /** @deprecated Phase 21.A1.2 — calibration thumbs move to `signalProposal`. */
  signalFinding(req: SignalFindingRequest): Promise<void>;
  // Proposals over findings (Phase 21.A1.2)
  listProposals(req: ListProposalsRequest): Promise<ProposalDto[]>;
  resolveProposal(req: ResolveProposalRequest): Promise<void>;
  signalProposal(req: SignalProposalRequest): Promise<void>;
}

// ---- Phase 13.G safety DTOs -----------------------------------------------
export interface PendingApproval {
  approval_id: string;
  workspace_id: WorkspaceId;
  artifact_id: ArtifactId;
  gate: string;
  summary: string;
  created_at: string;
}

export interface CostStatus {
  workspace_id: WorkspaceId;
  spent_dollars_cents: number;
  cap_dollars_cents: number | null;
  spent_tokens: number;
  cap_tokens: number | null;
  ratio: number | null;
}

export interface KeychainStatus {
  state: "connected" | "disconnected" | "unsupported_os";
  last_verified: string | null;
  message: string;
}

export interface CostChipPreferences {
  enabled: boolean;
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
  postMessage(req: PostMessageRequest) {
    return invoke<PostMessageResponse>("post_message", { req });
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
  listPendingApprovals(workspaceId?: WorkspaceId) {
    return invoke<PendingApproval[]>("cmd_list_pending_approvals", {
      workspaceId: workspaceId ?? null,
    });
  }
  getCostStatus(workspaceId: WorkspaceId) {
    return invoke<CostStatus>("cmd_get_cost_status", { workspaceId });
  }
  getKeychainStatus() {
    return invoke<KeychainStatus>("cmd_get_keychain_status");
  }
  getCostChipPreference() {
    return invoke<CostChipPreferences>("cmd_get_cost_chip_preference");
  }
  setCostChipPreference(enabled: boolean) {
    return invoke<CostChipPreferences>("cmd_set_cost_chip_preference", { enabled });
  }
  reportFriction(req: ReportFrictionRequest) {
    return invoke<ReportFrictionResponse>("cmd_report_friction", { req });
  }
  listFriction() {
    return invoke<FrictionEntry[]>("cmd_list_friction");
  }
  resolveFriction(req: FrictionTransitionRequest) {
    return invoke<void>("cmd_resolve_friction", { req });
  }
  addressFriction(req: AddressFrictionRequest) {
    return invoke<void>("cmd_address_friction", { req });
  }
  reopenFriction(req: FrictionTransitionRequest) {
    return invoke<void>("cmd_reopen_friction", { req });
  }
  async captureViewport() {
    // Tauri serializes `Vec<u8>` as a JSON array of numbers; lift it back
    // to a `Uint8Array` so callers can hand it to `Blob`/`URL.createObjectURL`
    // without re-coercing.
    const bytes = await invoke<number[]>("cmd_capture_viewport");
    return new Uint8Array(bytes);
  }
  async revealInFinder(path: string) {
    try {
      await invoke<void>("reveal_in_finder", { path });
    } catch (err) {
      // Fall back to clipboard so the user can paste into Finder's
      // "Go to Folder" prompt — same pattern as `WorkspaceSidebar`.
      console.warn("reveal_in_finder failed; copying path", err);
      await navigator.clipboard.writeText(path).catch(() => {});
    }
  }
  listFindings(projectId: ProjectId) {
    return invoke<FindingDto[]>("cmd_list_findings", { projectId });
  }
  signalFinding(req: SignalFindingRequest) {
    return invoke<void>("cmd_signal_finding", { req });
  }
  listProposals(req: ListProposalsRequest) {
    return invoke<ProposalDto[]>("cmd_list_proposals", { req });
  }
  resolveProposal(req: ResolveProposalRequest) {
    return invoke<void>("cmd_resolve_proposal", { req });
  }
  signalProposal(req: SignalProposalRequest) {
    return invoke<void>("cmd_signal_proposal", { req });
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
  postMessage(req: PostMessageRequest) {
    return Promise.resolve(this.core.postMessage(req));
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
  listPendingApprovals(workspaceId?: WorkspaceId) {
    const all = this.core.approvals().filter((a) => a.status === "pending");
    const rows: PendingApproval[] = all
      .filter((a) => !workspaceId || a.workspaceId === workspaceId)
      .map((a) => ({
        approval_id: a.id,
        workspace_id: a.workspaceId,
        artifact_id: a.id,
        gate: a.gate,
        summary: a.summary,
        created_at: new Date().toISOString(),
      }));
    return Promise.resolve(rows);
  }
  getCostStatus(workspaceId: WorkspaceId) {
    // Mock: pretend usage is 12% of a $10 cap so the chip renders a
    // realistic shape during local dev.
    return Promise.resolve<CostStatus>({
      workspace_id: workspaceId,
      spent_dollars_cents: 120,
      cap_dollars_cents: 1000,
      spent_tokens: 8_500,
      cap_tokens: 100_000,
      ratio: 0.12,
    });
  }
  getKeychainStatus() {
    return Promise.resolve<KeychainStatus>({
      state: "connected",
      last_verified: new Date().toISOString(),
      message: "Connected via macOS Keychain — Designer never reads your token.",
    });
  }
  getCostChipPreference() {
    return Promise.resolve<CostChipPreferences>({ enabled: false });
  }
  setCostChipPreference(enabled: boolean) {
    return Promise.resolve<CostChipPreferences>({ enabled });
  }
  reportFriction(_req: ReportFrictionRequest) {
    // Mock keeps an in-memory record so dev mode + tests can render the
    // triage page without a Tauri runtime. The real persistence layer
    // lives in core_friction.rs.
    return Promise.resolve<ReportFrictionResponse>({
      friction_id: `frc_mock_${Date.now()}`,
      local_path: "",
    });
  }
  listFriction() {
    return Promise.resolve<FrictionEntry[]>([]);
  }
  resolveFriction(_req: FrictionTransitionRequest) {
    return Promise.resolve();
  }
  addressFriction(_req: AddressFrictionRequest) {
    return Promise.resolve();
  }
  reopenFriction(_req: FrictionTransitionRequest) {
    return Promise.resolve();
  }
  captureViewport() {
    // 1×1 transparent PNG so dev/test runs of the friction widget produce
    // a non-empty preview without a Tauri runtime.
    const transparentPng = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
      0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
      0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
      0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ]);
    return Promise.resolve(transparentPng);
  }
  async revealInFinder(path: string) {
    // Web/test runtime: copy the path so the user can paste into Finder.
    await navigator.clipboard?.writeText?.(path).catch(() => {});
  }
  listFindings(_projectId: ProjectId) {
    return Promise.resolve<FindingDto[]>([]);
  }
  signalFinding(_req: SignalFindingRequest) {
    return Promise.resolve();
  }
  listProposals(_req: ListProposalsRequest) {
    return Promise.resolve<ProposalDto[]>([]);
  }
  resolveProposal(_req: ResolveProposalRequest) {
    return Promise.resolve();
  }
  signalProposal(_req: SignalProposalRequest) {
    return Promise.resolve();
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
