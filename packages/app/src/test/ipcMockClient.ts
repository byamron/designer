// Test helper: build a fully-formed `IpcClient` plain object with
// no-op / safe defaults for every method, then layer caller overrides
// on top.
//
// The whole reason this exists: the production `MockIpcClient`
// (`packages/app/src/ipc/mock.ts → MockIpcClient`) is a class. Tests
// that captured `originalClient = ipcClient()` and then built per-test
// fixtures with `{ ...originalClient, ...overrides }` were silently
// dropping every method that lives on the prototype — JavaScript
// spread copies own enumerable properties only. The bug stayed
// invisible until a component added a new IPC dependency that the
// test hadn't pre-overridden, at which point it surfaced as a runtime
// `is not a function` deep inside React (see FB-0039).
//
// Use this helper instead of spreading any captured-from-`ipcClient()`
// instance. The defaults here are intentionally minimal — every method
// returns the safest empty-shaped value for its return type — so tests
// only have to override the methods they care about, and a future
// `IpcClient` addition shows up here as a single additional default
// rather than an inscrutable test failure.
//
// Layering: `mockIpcClient(overrides)` returns `{ ...defaults, ...overrides }`.
// Both are plain objects, so the spread is safe; methods you supply
// always win.

import type {
  ArtifactDetail,
  ArtifactId,
  ArtifactSummary,
  FrictionEntry,
  ProjectId,
  ProjectSummary,
  TabId,
  TrackId,
  TrackSummary,
  WorkspaceId,
  WorkspaceSummary,
} from "../ipc/types";
import type {
  CostStatus,
  FeatureFlags,
  IpcClient,
  KeychainStatus,
  PendingApproval,
} from "../ipc/client";

/** Build a complete `IpcClient` for a test, layering overrides on top
 *  of safe defaults. Use as the canonical replacement for
 *  `{ ...originalClient, ...overrides }` patterns; never spread a
 *  client returned from `ipcClient()` (it's a class instance — methods
 *  are on the prototype and don't survive the spread). */
export function mockIpcClient(overrides: Partial<IpcClient> = {}): IpcClient {
  const defaults: IpcClient = {
    listProjects: () => Promise.resolve<ProjectSummary[]>([]),
    createProject: () =>
      Promise.reject(new Error("mockIpcClient: createProject not stubbed")),
    listWorkspaces: () => Promise.resolve<WorkspaceSummary[]>([]),
    createWorkspace: () =>
      Promise.reject(new Error("mockIpcClient: createWorkspace not stubbed")),
    archiveWorkspace: () => Promise.resolve(),
    restoreWorkspace: () => Promise.resolve(),
    deleteWorkspace: () => Promise.resolve(),
    openTab: () =>
      Promise.reject(new Error("mockIpcClient: openTab not stubbed")),
    closeTab: () => Promise.resolve(),
    spine: () => Promise.resolve([]),
    stream: () => () => {},
    activityStream: () => () => {},
    requestApproval: () =>
      Promise.reject(new Error("mockIpcClient: requestApproval not stubbed")),
    resolveApproval: () => Promise.resolve(),
    listArtifacts: () => Promise.resolve<ArtifactSummary[]>([]),
    listArtifactsInTab: (_w: WorkspaceId, _t: TabId) =>
      Promise.resolve<ArtifactSummary[]>([]),
    listSpineArtifacts: () => Promise.resolve<ArtifactSummary[]>([]),
    listPinnedArtifacts: () => Promise.resolve<ArtifactSummary[]>([]),
    getArtifact: (_id: ArtifactId) =>
      Promise.reject<ArtifactDetail>(
        new Error("mockIpcClient: getArtifact not stubbed"),
      ),
    togglePinArtifact: () => Promise.resolve(false),
    postMessage: () =>
      Promise.reject(new Error("mockIpcClient: postMessage not stubbed")),
    interruptTurn: () => Promise.resolve(),
    linkRepo: () => Promise.resolve(),
    unlinkRepo: () => Promise.resolve(),
    startTrack: () =>
      Promise.reject<TrackId>(
        new Error("mockIpcClient: startTrack not stubbed"),
      ),
    requestMerge: () =>
      Promise.reject(new Error("mockIpcClient: requestMerge not stubbed")),
    listTracks: () => Promise.resolve<TrackSummary[]>([]),
    getTrack: () =>
      Promise.reject<TrackSummary>(
        new Error("mockIpcClient: getTrack not stubbed"),
      ),
    listPendingApprovals: () => Promise.resolve<PendingApproval[]>([]),
    getCostStatus: (workspaceId: WorkspaceId) =>
      Promise.resolve<CostStatus>({
        workspace_id: workspaceId,
        spent_dollars_cents: 0,
        cap_dollars_cents: null,
        spent_tokens: 0,
        cap_tokens: null,
        ratio: null,
      }),
    getKeychainStatus: () =>
      Promise.resolve<KeychainStatus>({
        state: "connected",
        last_verified: null,
        message: "stub",
      }),
    getCostChipPreference: () => Promise.resolve({ enabled: false }),
    setCostChipPreference: (enabled: boolean) => Promise.resolve({ enabled }),
    getFeatureFlags: () =>
      Promise.resolve<FeatureFlags>({
        show_models_section: false,
        show_all_artifacts_in_spine: false,
        show_recent_reports_v2: false,
      }),
    setFeatureFlag: (name, enabled) =>
      Promise.resolve<FeatureFlags>({
        show_models_section: name === "show_models_section" ? enabled : false,
        show_all_artifacts_in_spine:
          name === "show_all_artifacts_in_spine" ? enabled : false,
        show_recent_reports_v2:
          name === "show_recent_reports_v2" ? enabled : false,
      }),
    listRecentReports: () => Promise.resolve([]),
    getReportsUnreadCount: () => Promise.resolve(0),
    markReportsRead: () => Promise.resolve(0),
    reportFriction: () =>
      Promise.resolve({ friction_id: "frc_stub", local_path: "" }),
    listFriction: () => Promise.resolve<FrictionEntry[]>([]),
    resolveFriction: () => Promise.resolve(),
    addressFriction: () => Promise.resolve(),
    reopenFriction: () => Promise.resolve(),
    captureViewport: () => Promise.resolve(new Uint8Array()),
    revealInFinder: () => Promise.resolve(),
    onStoreChanged: () => () => {},
    listFindings: (_p: ProjectId) => Promise.resolve([]),
    signalFinding: () => Promise.resolve(),
    listProposals: () => Promise.resolve([]),
    resolveProposal: () => Promise.resolve(),
    signalProposal: () => Promise.resolve(),
  };
  return { ...defaults, ...overrides };
}
