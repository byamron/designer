// Typed IPC client. Under Tauri, delegates to the runtime adapter in ./tauri.
// In a browser (dev, tests), delegates to the in-memory mock so the surface is
// exercisable without the WebView. Callers never know which runtime they're on.

import type {
  ActivityChanged,
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
  RecentReportRow,
  ReportFrictionRequest,
  ReportFrictionResponse,
  RequestMergeRequest,
  CompleteTrackRequest,
  ResolveProposalRequest,
  SignalFindingRequest,
  SignalProposalRequest,
  SpineRow,
  StartTrackRequest,
  Tab,
  TabId,
  TrackId,
  TrackSummary,
  UnlinkRepoRequest,
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
  /** Rename a workspace. Trims; rejects empty. */
  renameWorkspace(workspaceId: WorkspaceId, name: string): Promise<WorkspaceSummary>;
  /** Rename a tab. Trims; rejects empty. */
  renameTab(
    workspaceId: WorkspaceId,
    tabId: TabId,
    title: string,
  ): Promise<Tab>;
  /** Soft-archive a workspace. Idempotent. */
  archiveWorkspace(workspaceId: WorkspaceId): Promise<void>;
  /** Move an archived workspace back to active. Idempotent. */
  restoreWorkspace(workspaceId: WorkspaceId): Promise<void>;
  /** Hard-delete a workspace. Drops the projection; the event log
   *  retains the historical events for audit. Caller is expected to
   *  confirm with the user — the UI gates this behind the Archived
   *  section and a confirm prompt. */
  deleteWorkspace(workspaceId: WorkspaceId): Promise<void>;
  openTab(req: OpenTabRequest): Promise<Tab>;
  closeTab(workspaceId: WorkspaceId, tabId: TabId): Promise<void>;
  spine(id: WorkspaceId | null): Promise<SpineRow[]>;
  stream(handler: (event: StreamEvent) => void): () => void;
  /** Phase 23.B — subscribe to per-tab `ActivityChanged` events
   *  emitted by the orchestrator (broadcast-only, off the persisted
   *  event stream). Returns an unsubscribe fn. */
  activityStream(handler: (event: ActivityChanged) => void): () => void;
  requestApproval(
    workspaceId: WorkspaceId,
    gate: string,
    summary: string,
  ): Promise<string>;
  resolveApproval(id: string, granted: boolean, reason?: string): Promise<void>;
  // Artifacts (Phase 13.1)
  listArtifacts(workspaceId: WorkspaceId): Promise<ArtifactSummary[]>;
  /** Per-tab thread view (per-tab thread isolation). Returns
   *  workspace-wide artifacts plus only the messages for `tabId`. */
  listArtifactsInTab(
    workspaceId: WorkspaceId,
    tabId: TabId,
  ): Promise<ArtifactSummary[]>;
  /// Activity-spine read — applies the substantive-kind allowlist
  /// (spec / prototype / code-change / pr / recap & auditor reports)
  /// so the rail isn't polluted by tool-use cards. Honors the
  /// `show_all_artifacts_in_spine` feature flag for debugging.
  listSpineArtifacts(workspaceId: WorkspaceId): Promise<ArtifactSummary[]>;
  listPinnedArtifacts(workspaceId: WorkspaceId): Promise<ArtifactSummary[]>;
  getArtifact(id: ArtifactId): Promise<ArtifactDetail>;
  togglePinArtifact(id: ArtifactId): Promise<boolean>;
  // Agent wire (Phase 13.D)
  postMessage(req: PostMessageRequest): Promise<PostMessageResponse>;
  /** Phase 23.F — Stop turn. Tells the per-tab Claude subprocess to abort
   *  the current turn cleanly. Resolves once the control_request is
   *  queued onto stdin; the resulting `ActivityChanged{Idle}` arrives
   *  over `activityStream`. Calling against a tab with no live turn is
   *  a silent no-op. */
  interruptTurn(workspaceId: WorkspaceId, tabId: TabId): Promise<void>;
  // Track + git wire (Phase 13.E)
  linkRepo(req: LinkRepoRequest): Promise<void>;
  /// Sever Designer's pointer to the workspace's repo. Idempotent — safe
  /// to call when the workspace is already unlinked. The repo on disk is
  /// untouched; only Designer's projection is cleared.
  unlinkRepo(req: UnlinkRepoRequest): Promise<void>;
  startTrack(req: StartTrackRequest): Promise<TrackId>;
  requestMerge(req: RequestMergeRequest): Promise<number>;
  /** Phase 22.I — emit `TrackCompleted` (+ `NodeShipmentRecorded` when
   * the track is anchored). Idempotent against repeat calls; the
   * backend short-circuits if the track is already Merged or Archived. */
  completeTrack(req: CompleteTrackRequest): Promise<void>;
  listTracks(workspaceId: WorkspaceId): Promise<TrackSummary[]>;
  getTrack(id: TrackId): Promise<TrackSummary>;
  // Safety surfaces (Phase 13.G)
  listPendingApprovals(workspaceId?: WorkspaceId): Promise<PendingApproval[]>;
  getCostStatus(workspaceId: WorkspaceId): Promise<CostStatus>;
  getKeychainStatus(): Promise<KeychainStatus>;
  getCostChipPreference(): Promise<CostChipPreferences>;
  setCostChipPreference(enabled: boolean): Promise<CostChipPreferences>;
  // Feature flags (DP-C reliability audit)
  getFeatureFlags(): Promise<FeatureFlags>;
  setFeatureFlag(name: keyof FeatureFlags, enabled: boolean): Promise<FeatureFlags>;
  // Recent Reports (Phase 22.B)
  listRecentReports(projectId: ProjectId, limit?: number): Promise<RecentReportRow[]>;
  getReportsUnreadCount(projectId: ProjectId): Promise<number>;
  markReportsRead(projectId: ProjectId): Promise<number>;
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
  /// Subscribe to `designer://store-changed`, which the Rust core emits
  /// (debounced ~500ms) when an external process mutates the on-disk
  /// event log — typically the `designer` CLI's `friction address|
  /// resolve|reopen` subcommands. Listeners refetch derived data so the
  /// UI doesn't drift from disk. Returns an unsubscribe fn.
  onStoreChanged(handler: () => void): () => void;
  // Learning layer (Phase 21.A1)
  listFindings(projectId: ProjectId): Promise<FindingDto[]>;
  /** @deprecated Phase 21.A1.2 — calibration thumbs move to `signalProposal`. */
  signalFinding(req: SignalFindingRequest): Promise<void>;
  // Proposals over findings (Phase 21.A1.2)
  listProposals(req: ListProposalsRequest): Promise<ProposalDto[]>;
  resolveProposal(req: ResolveProposalRequest): Promise<void>;
  signalProposal(req: SignalProposalRequest): Promise<void>;
  // Roadmap canvas (Phase 22.A)
  getRoadmap(projectId: ProjectId): Promise<RoadmapView>;
  setNodeStatus(
    projectId: ProjectId,
    nodeId: NodeId,
    status: NodeStatus,
  ): Promise<void>;
  writeRoadmapDraft(projectId: ProjectId, content: string): Promise<void>;
}

// ---- Phase 22.A roadmap canvas DTOs ---------------------------------------
export type NodeId = string;
export type NodeStatus =
  | "backlog"
  | "todo"
  | "in-progress"
  | "in-review"
  | "done"
  | "canceled"
  | "blocked";

export interface RoadmapNode {
  id: NodeId;
  parent_id: NodeId | null;
  depth: number;
  headline: string;
  body_offset: number;
  body_length: number;
  child_ids: NodeId[];
  external_source?: ExternalSource | null;
  status: NodeStatus;
  shipped_at?: string | null;
  shipped_pr?: { url: string; number: number | null } | null;
}

export type ExternalSource =
  | { kind: "linear"; issue_id: string }
  | { kind: "git-hub"; repo: string; number: number }
  | { kind: "url"; href: string };

export interface NodeView extends RoadmapNode {
  derived_status: NodeStatus;
}

export interface NodeClaim {
  node_id: NodeId;
  workspace_id: WorkspaceId;
  track_id: TrackId;
  subagent_role?: string | null;
  claimed_at: string;
}

export interface NodeShipment {
  node_id: NodeId;
  workspace_id: WorkspaceId;
  track_id: TrackId;
  pr_url: string;
  shipped_at: string;
}

export interface RoadmapTreeView {
  source: string;
  nodes: NodeView[];
}

export interface RoadmapParseError {
  line: number;
  column?: number | null;
  snippet: string;
  hint: string;
}

export interface NodeClaimsForView {
  node_id: NodeId;
  claims: NodeClaim[];
}

export interface NodeShipmentsForView {
  node_id: NodeId;
  shipments: NodeShipment[];
}

export interface RoadmapHash {
  mtime_unix_secs: number;
  size_bytes: number;
  content_hash: string;
}

export interface RoadmapView {
  tree: RoadmapTreeView | null;
  parse_error: RoadmapParseError | null;
  claims: NodeClaimsForView[];
  shipments: NodeShipmentsForView[];
  source_hash: RoadmapHash | null;
  /** Absolute path to core-docs/roadmap.md, resolved server-side. */
  roadmap_path: string;
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

/**
 * DP-C feature flags. Each field is an opt-in toggle for a surface that
 * isn't ready for default-on dogfood (placeholder UI, missing payload
 * source, etc.). Default OFF. Mirrors `FeatureFlagsResponse` on the
 * Rust side; add new flags in lock-step.
 */
export interface FeatureFlags {
  show_models_section: boolean;
  show_all_artifacts_in_spine: boolean;
  /** Phase 22.A — render the Roadmap canvas as the lead Home-tab surface. */
  show_roadmap_canvas: boolean;
  /** Phase 22.B — show the new Recent Reports surface on Home. */
  show_recent_reports_v2: boolean;
}

export const EVENT_STREAM_CHANNEL = "designer://event-stream";
export const STORE_CHANGED_CHANNEL = "designer://store-changed";
export const ACTIVITY_CHANNEL = "designer://activity-changed";

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
  renameWorkspace(workspaceId: WorkspaceId, name: string) {
    return invoke<WorkspaceSummary>("rename_workspace", {
      req: { workspace_id: workspaceId, name },
    });
  }
  renameTab(workspaceId: WorkspaceId, tabId: TabId, title: string) {
    return invoke<Tab>("rename_tab", {
      req: { workspace_id: workspaceId, tab_id: tabId, title },
    });
  }
  archiveWorkspace(workspaceId: WorkspaceId) {
    return invoke<void>("archive_workspace", { workspaceId });
  }
  restoreWorkspace(workspaceId: WorkspaceId) {
    return invoke<void>("restore_workspace", { workspaceId });
  }
  deleteWorkspace(workspaceId: WorkspaceId) {
    return invoke<void>("delete_workspace", { workspaceId });
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
  activityStream(handler: (event: ActivityChanged) => void) {
    return listen<ActivityChanged>(ACTIVITY_CHANNEL, handler);
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
  listArtifactsInTab(workspaceId: WorkspaceId, tabId: TabId) {
    return invoke<ArtifactSummary[]>("list_artifacts_in_tab", {
      workspaceId,
      tabId,
    });
  }
  listSpineArtifacts(workspaceId: WorkspaceId) {
    return invoke<ArtifactSummary[]>("list_spine_artifacts", { workspaceId });
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
  interruptTurn(workspaceId: WorkspaceId, tabId: TabId) {
    return invoke<void>("interrupt_turn", {
      req: { workspace_id: workspaceId, tab_id: tabId },
    });
  }
  linkRepo(req: LinkRepoRequest) {
    return invoke<void>("cmd_link_repo", { req });
  }
  unlinkRepo(req: UnlinkRepoRequest) {
    return invoke<void>("cmd_unlink_repo", { req });
  }
  startTrack(req: StartTrackRequest) {
    return invoke<TrackId>("cmd_start_track", { req });
  }
  requestMerge(req: RequestMergeRequest) {
    return invoke<number>("cmd_request_merge", { req });
  }
  completeTrack(req: CompleteTrackRequest) {
    return invoke<void>("cmd_complete_track", { req });
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
  getFeatureFlags() {
    return invoke<FeatureFlags>("cmd_get_feature_flags");
  }
  setFeatureFlag(name: keyof FeatureFlags, enabled: boolean) {
    return invoke<FeatureFlags>("cmd_set_feature_flag", { name, enabled });
  }
  listRecentReports(projectId: ProjectId, limit?: number) {
    return invoke<RecentReportRow[]>("cmd_list_recent_reports", {
      projectId,
      limit: limit ?? null,
    });
  }
  getReportsUnreadCount(projectId: ProjectId) {
    return invoke<number>("cmd_get_reports_unread_count", { projectId });
  }
  markReportsRead(projectId: ProjectId) {
    return invoke<number>("cmd_mark_reports_read", { projectId });
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
  onStoreChanged(handler: () => void) {
    return listen<unknown>(STORE_CHANGED_CHANNEL, () => handler());
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
  getRoadmap(projectId: ProjectId) {
    return invoke<RoadmapView>("cmd_get_roadmap", { projectId });
  }
  setNodeStatus(projectId: ProjectId, nodeId: NodeId, status: NodeStatus) {
    return invoke<void>("cmd_set_node_status", {
      projectId,
      nodeId,
      status,
    });
  }
  writeRoadmapDraft(projectId: ProjectId, content: string) {
    return invoke<void>("cmd_write_roadmap_draft", { projectId, content });
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
  renameWorkspace(workspaceId: WorkspaceId, name: string) {
    return Promise.resolve(this.core.renameWorkspace(workspaceId, name));
  }
  renameTab(workspaceId: WorkspaceId, tabId: TabId, title: string) {
    return Promise.resolve(this.core.renameTab(workspaceId, tabId, title));
  }
  archiveWorkspace(workspaceId: WorkspaceId) {
    this.core.archiveWorkspace(workspaceId);
    return Promise.resolve();
  }
  restoreWorkspace(workspaceId: WorkspaceId) {
    this.core.restoreWorkspace(workspaceId);
    return Promise.resolve();
  }
  deleteWorkspace(workspaceId: WorkspaceId) {
    this.core.deleteWorkspace(workspaceId);
    return Promise.resolve();
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
  activityStream(handler: (event: ActivityChanged) => void) {
    return this.core.subscribeActivity(handler);
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
  listArtifactsInTab(workspaceId: WorkspaceId, tabId: TabId) {
    return Promise.resolve(this.core.listArtifactsInTab(workspaceId, tabId));
  }
  listSpineArtifacts(workspaceId: WorkspaceId) {
    return Promise.resolve(this.core.listSpineArtifacts(workspaceId));
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
  interruptTurn(workspaceId: WorkspaceId, tabId: TabId) {
    this.core.interruptTurn(workspaceId, tabId);
    return Promise.resolve();
  }
  linkRepo(req: LinkRepoRequest) {
    return Promise.resolve(this.core.linkRepo(req));
  }
  unlinkRepo(req: UnlinkRepoRequest) {
    return Promise.resolve(this.core.unlinkRepo(req));
  }
  startTrack(req: StartTrackRequest) {
    return Promise.resolve(this.core.startTrack(req));
  }
  requestMerge(req: RequestMergeRequest) {
    return Promise.resolve(this.core.requestMerge(req));
  }
  completeTrack(req: CompleteTrackRequest) {
    this.core.completeTrack?.(req);
    return Promise.resolve();
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
  // DP-C — keep a small in-memory map so the dev/mock mode can flip
  // flags from Settings without a Tauri runtime. Default all flags off
  // to mirror the Rust default.
  private mockFlags: FeatureFlags = {
    show_models_section: false,
    show_all_artifacts_in_spine: false,
    show_roadmap_canvas: false,
    show_recent_reports_v2: false,
  };
  private mockReportReadAt: Map<ProjectId, string> = new Map();
  getFeatureFlags() {
    return Promise.resolve<FeatureFlags>({ ...this.mockFlags });
  }
  setFeatureFlag(name: keyof FeatureFlags, enabled: boolean) {
    this.mockFlags = { ...this.mockFlags, [name]: enabled };
    return Promise.resolve<FeatureFlags>({ ...this.mockFlags });
  }
  listRecentReports(_projectId: ProjectId, _limit?: number) {
    // Dev mode: empty list keeps the surface honest about not having
    // shipped reports yet. Tests seed via __setIpcClient.
    return Promise.resolve<RecentReportRow[]>([]);
  }
  getReportsUnreadCount(_projectId: ProjectId) {
    return Promise.resolve(0);
  }
  markReportsRead(projectId: ProjectId) {
    this.mockReportReadAt.set(projectId, new Date().toISOString());
    return Promise.resolve(0);
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
  onStoreChanged(_handler: () => void) {
    // Mock runtime: no fs-watch source. Return a noop unsubscribe so
    // tests don't have to special-case the absence.
    return () => {};
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
  getRoadmap(_projectId: ProjectId) {
    // Mock: empty roadmap (drives the "Paste a draft" empty-state slab).
    return Promise.resolve<RoadmapView>({
      tree: null,
      parse_error: null,
      claims: [],
      shipments: [],
      source_hash: null,
      roadmap_path: "core-docs/roadmap.md",
    });
  }
  setNodeStatus(_p: ProjectId, _n: NodeId, _s: NodeStatus) {
    return Promise.resolve();
  }
  writeRoadmapDraft(_p: ProjectId, _c: string) {
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
