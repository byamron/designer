// Test-specific fixtures for visual regression. Intentionally NOT reusing
// `src/ipc/mock.ts` — that mock seeds dev/demo data which drifts over time
// and would push baselines out of sync with every UX tweak. Visual baselines
// must be pinned to fixed inputs.
//
// All timestamps are anchored relative to `FIXED_NOW_ISO`, which the test
// setup (`./setup.ts`) installs as `Date.now()` for the entire run.

import type { IpcClient, PendingApproval } from "../../ipc/client";
import type {
  ActivityChanged,
  ArtifactDetail,
  ArtifactId,
  ArtifactSummary,
  CostChipPreferences,
  CostStatus,
  KeychainStatus,
  Project,
  ProjectSummary,
  StreamEvent,
  Workspace,
  WorkspaceSummary,
} from "../../ipc/types";
import { activityKey, dataStore } from "../../store/data";

export const FIXED_NOW_ISO = "2026-05-01T12:00:00.000Z";
export const FIXED_NOW_MS = Date.parse(FIXED_NOW_ISO);

const minutesAgo = (n: number) =>
  new Date(FIXED_NOW_MS - n * 60_000).toISOString();
const hoursAgo = (n: number) =>
  new Date(FIXED_NOW_MS - n * 3_600_000).toISOString();
const daysAgo = (n: number) =>
  new Date(FIXED_NOW_MS - n * 86_400_000).toISOString();

const FIXTURE_PROJECT_ID = "proj_visual_designer";
const FIXTURE_WORKSPACE_ID = "ws_visual_thread";
const FIXTURE_TAB_ID = "tab_visual_thread";

export const fixtureProject: Project = {
  id: FIXTURE_PROJECT_ID,
  name: "Designer",
  root_path: "/Users/test/code/designer",
  created_at: daysAgo(14),
  archived_at: null,
  autonomy: "suggest",
};

export const fixtureWorkspace: Workspace = {
  id: FIXTURE_WORKSPACE_ID,
  project_id: FIXTURE_PROJECT_ID,
  name: "approval-inbox-pass",
  state: "active",
  status: "in_progress",
  base_branch: "main",
  worktree_path: "/Users/test/code/designer-worktrees/approval-inbox-pass",
  created_at: hoursAgo(6),
  tabs: [
    {
      id: FIXTURE_TAB_ID,
      title: "Thread",
      template: "thread",
      created_at: hoursAgo(6),
      closed_at: null,
    },
  ],
};

// Phase 23.B — seed a `Working` activity slice for the fixture's
// (workspace, tab). The dock's `ComposeDockActivityRow` reads
// `dataStore.activity[activityKey(...)]`; without an entry it renders
// nothing and the snapshot would silently lose the dock-row chrome we
// want to baseline. `since_ms === FIXED_NOW_MS` pins the elapsed
// counter at "0:00" so the baseline is deterministic.
export const fixtureActivityEvent: ActivityChanged = {
  workspace_id: FIXTURE_WORKSPACE_ID,
  tab_id: FIXTURE_TAB_ID,
  state: "working",
  since_ms: FIXED_NOW_MS,
};

export const fixtureProjectSummaries: ProjectSummary[] = [
  { project: fixtureProject, workspace_count: 1 },
];

export const fixtureWorkspaceSummaries: WorkspaceSummary[] = [
  {
    workspace: fixtureWorkspace,
    state: "active",
    agent_count: 1,
  },
  {
    workspace: {
      ...fixtureWorkspace,
      id: "ws_visual_secondary",
      name: "design-language-pass",
      status: "pr_open",
      tabs: [
        {
          id: "tab_visual_secondary",
          title: "Update home tokens",
          template: "thread",
          created_at: hoursAgo(2),
          closed_at: null,
        },
      ],
    },
    state: "active",
    agent_count: 1,
  },
];

// "Needs your attention" rows — drives the Home approval surface. Two
// approval-requested events render the section with a count badge.
export const fixtureAttentionEvents: StreamEvent[] = [
  {
    kind: "approval_requested",
    stream_id: `workspace:${FIXTURE_WORKSPACE_ID}`,
    sequence: 101,
    timestamp: minutesAgo(15),
    summary: "git push origin approval-inbox-pass",
  },
  {
    kind: "auditor_flagged",
    stream_id: `workspace:${FIXTURE_WORKSPACE_ID}`,
    sequence: 102,
    timestamp: hoursAgo(2),
    summary: "Migration drops a column referenced in api/users.ts",
  },
];

// Workspace-thread artifacts — covers the four block kinds the thread
// renders today: agent message, user message, tool-use line, approval card.
const ART_USER: ArtifactSummary = {
  id: "art_user_1",
  workspace_id: FIXTURE_WORKSPACE_ID,
  kind: "message",
  title: "User message",
  summary:
    "Add a pending-approval card to the workspace thread. Should match the spec in core-docs/spec.md §6.",
  author_role: "user",
  version: 1,
  created_at: minutesAgo(35),
  updated_at: minutesAgo(35),
  pinned: false,
};

const ART_AGENT_REPLY: ArtifactSummary = {
  id: "art_agent_1",
  workspace_id: FIXTURE_WORKSPACE_ID,
  kind: "message",
  title: "Agent reply",
  summary:
    "Looking at `core-docs/spec.md` now. The approval card is described in §6.2 — block-level chrome, **Grant** / **Deny** actions, and live state via the stream listener.",
  author_role: "claude",
  version: 1,
  created_at: minutesAgo(33),
  updated_at: minutesAgo(33),
  pinned: false,
};

const ART_TOOL_READ: ArtifactSummary = {
  id: "art_tool_1",
  workspace_id: FIXTURE_WORKSPACE_ID,
  kind: "report",
  title: "Read core-docs/spec.md",
  summary: "Read 412 lines from the canonical spec.",
  author_role: "claude",
  version: 1,
  created_at: minutesAgo(32),
  updated_at: minutesAgo(32),
  pinned: false,
};

const ART_TOOL_EDIT: ArtifactSummary = {
  id: "art_tool_2",
  workspace_id: FIXTURE_WORKSPACE_ID,
  kind: "report",
  title: "Edited packages/app/src/blocks/blocks.tsx",
  summary: "Added approval-actions row + state machine.",
  author_role: "claude",
  version: 1,
  created_at: minutesAgo(28),
  updated_at: minutesAgo(28),
  pinned: false,
};

const APPROVAL_ID = "appr_visual_1";
const ART_APPROVAL: ArtifactSummary = {
  id: "art_approval_1",
  workspace_id: FIXTURE_WORKSPACE_ID,
  kind: "approval",
  title: "git push origin approval-inbox-pass",
  summary:
    "Push 14 commits to a remote branch. This is reversible (no force) but visible on GitHub.",
  author_role: "auditor",
  version: 1,
  created_at: minutesAgo(15),
  updated_at: minutesAgo(15),
  pinned: false,
};

export const fixtureThreadArtifacts: ArtifactSummary[] = [
  ART_USER,
  ART_AGENT_REPLY,
  ART_TOOL_READ,
  ART_TOOL_EDIT,
  ART_APPROVAL,
];

const APPROVAL_PAYLOAD: ArtifactDetail = {
  summary: ART_APPROVAL,
  payload: {
    kind: "inline",
    body: JSON.stringify({
      approval_id: APPROVAL_ID,
      tool: "git",
      gate: "remote_push",
      reason: "Push to origin/approval-inbox-pass",
    }),
  },
};

const PAYLOADS: Record<ArtifactId, ArtifactDetail> = {
  [ART_APPROVAL.id]: APPROVAL_PAYLOAD,
};

// A second approval-only thread for the "approval inbox" screen. Two
// pending approvals stacked, plus a small heading message at the top so
// the surface reads as a queue, not a single card.
const ART_INBOX_HEADER: ArtifactSummary = {
  id: "art_inbox_header",
  workspace_id: FIXTURE_WORKSPACE_ID,
  kind: "message",
  title: "Inbox header",
  summary: "Two approvals waiting on you. Reversible work only.",
  author_role: "designer",
  version: 1,
  created_at: minutesAgo(20),
  updated_at: minutesAgo(20),
  pinned: false,
};

const ART_INBOX_APPR_1: ArtifactSummary = {
  id: "art_inbox_appr_1",
  workspace_id: FIXTURE_WORKSPACE_ID,
  kind: "approval",
  title: "git push origin approval-inbox-pass",
  summary: "Push 14 commits — reversible, no force.",
  author_role: "auditor",
  version: 1,
  created_at: minutesAgo(15),
  updated_at: minutesAgo(15),
  pinned: false,
};

const ART_INBOX_APPR_2: ArtifactSummary = {
  id: "art_inbox_appr_2",
  workspace_id: FIXTURE_WORKSPACE_ID,
  kind: "approval",
  title: "Run npm install --workspace @designer/app",
  summary: "Adds 7 dev deps to packages/app/package.json. Lockfile changes.",
  author_role: "auditor",
  version: 1,
  created_at: minutesAgo(8),
  updated_at: minutesAgo(8),
  pinned: false,
};

export const fixtureInboxArtifacts: ArtifactSummary[] = [
  ART_INBOX_HEADER,
  ART_INBOX_APPR_1,
  ART_INBOX_APPR_2,
];

const INBOX_PAYLOADS: Record<ArtifactId, ArtifactDetail> = {
  [ART_INBOX_APPR_1.id]: {
    summary: ART_INBOX_APPR_1,
    payload: {
      kind: "inline",
      body: JSON.stringify({
        approval_id: "appr_inbox_1",
        tool: "git",
        gate: "remote_push",
      }),
    },
  },
  [ART_INBOX_APPR_2.id]: {
    summary: ART_INBOX_APPR_2,
    payload: {
      kind: "inline",
      body: JSON.stringify({
        approval_id: "appr_inbox_2",
        tool: "shell",
        gate: "package_install",
      }),
    },
  },
};

export const fixturePendingApprovals: PendingApproval[] = [
  {
    approval_id: "appr_inbox_1",
    workspace_id: FIXTURE_WORKSPACE_ID,
    artifact_id: ART_INBOX_APPR_1.id,
    gate: "remote_push",
    summary: ART_INBOX_APPR_1.summary,
    created_at: ART_INBOX_APPR_1.created_at,
  },
  {
    approval_id: "appr_inbox_2",
    workspace_id: FIXTURE_WORKSPACE_ID,
    artifact_id: ART_INBOX_APPR_2.id,
    gate: "package_install",
    summary: ART_INBOX_APPR_2.summary,
    created_at: ART_INBOX_APPR_2.created_at,
  },
];

const STABLE_COST: CostStatus = {
  workspace_id: FIXTURE_WORKSPACE_ID,
  spent_dollars_cents: 120,
  cap_dollars_cents: 1000,
  spent_tokens: 8_500,
  cap_tokens: 100_000,
  ratio: 0.12,
};

const STABLE_KEYCHAIN: KeychainStatus = {
  state: "connected",
  last_verified: FIXED_NOW_ISO,
  message: "Connected via macOS Keychain",
};

const STABLE_COST_PREFS: CostChipPreferences = { enabled: false };

export interface VisualIpcOverrides {
  artifacts?: ArtifactSummary[];
  payloads?: Record<ArtifactId, ArtifactDetail>;
  pendingApprovals?: PendingApproval[];
}

export function createVisualIpcClient(
  overrides: VisualIpcOverrides = {},
): IpcClient {
  const artifacts = overrides.artifacts ?? fixtureThreadArtifacts;
  const payloads = overrides.payloads ?? PAYLOADS;
  const pendingApprovals =
    overrides.pendingApprovals ?? fixturePendingApprovals;

  // Visual tests render components in isolation — they don't call
  // `bootData()`, so the activity slice is never populated through the
  // normal `client.activityStream(...)` subscription path. Seed it
  // directly here so the dock row + (any tab-strip badge) renders in
  // the snapshot. Idempotent — re-running before each test re-applies
  // the same `Working` slice.
  dataStore.set((s) => ({
    ...s,
    activity: {
      ...s.activity,
      [activityKey(
        fixtureActivityEvent.workspace_id,
        fixtureActivityEvent.tab_id,
      )]: {
        state: fixtureActivityEvent.state,
        since_ms: fixtureActivityEvent.since_ms,
      },
    },
  }));

  return {
    listProjects: () => Promise.resolve(fixtureProjectSummaries),
    createProject: () => Promise.reject(new Error("not in fixture")),
    listWorkspaces: () => Promise.resolve(fixtureWorkspaceSummaries),
    createWorkspace: () => Promise.reject(new Error("not in fixture")),
    renameWorkspace: () => Promise.reject(new Error("not in fixture")),
    renameTab: () => Promise.reject(new Error("not in fixture")),
    archiveWorkspace: () => Promise.resolve(),
    restoreWorkspace: () => Promise.resolve(),
    deleteWorkspace: () => Promise.resolve(),
    openTab: () => Promise.reject(new Error("not in fixture")),
    closeTab: () => Promise.resolve(),
    spine: () => Promise.resolve([]),
    // No event emission — fixtures are static. Returning a noop unsubscribe
    // keeps subscribers happy without leaking timers or promises.
    stream: () => () => {},
    // Synchronously deliver the seeded `Working` event so any consumer
    // that DOES go through `bootData()` (or wires its own subscription)
    // also lands the slice. Visual tests don't bootstrap, so the
    // direct `dataStore.set` above is what the screenshot relies on —
    // this just keeps the wire contract honest.
    activityStream: (handler) => {
      handler(fixtureActivityEvent);
      return () => {};
    },
    teamLifecycleStream: () => () => {},
    listWorkspaceChatEvents: () => Promise.resolve([]),
    requestApproval: () => Promise.resolve("appr_stub"),
    resolveApproval: () => Promise.resolve(),
    listArtifacts: () => Promise.resolve(artifacts),
    listArtifactsInTab: () => Promise.resolve(artifacts),
    listSpineArtifacts: () => Promise.resolve(artifacts),
    listPinnedArtifacts: () => Promise.resolve([]),
    getArtifact: (id) => {
      const detail = payloads[id];
      if (detail) return Promise.resolve(detail);
      return Promise.reject(new Error(`fixture missing payload for ${id}`));
    },
    togglePinArtifact: () => Promise.resolve(true),
    postMessage: () => Promise.resolve({ artifact_id: "art_new" }),
    interruptTurn: () => Promise.resolve(),
    linkRepo: () => Promise.resolve(),
    unlinkRepo: () => Promise.resolve(),
    startTrack: () => Promise.resolve("trk_stub"),
    requestMerge: () => Promise.resolve(0),
    completeTrack: () => Promise.resolve(),
    listTracks: () => Promise.resolve([]),
    getTrack: () => Promise.reject(new Error("not in fixture")),
    listPendingApprovals: () => Promise.resolve(pendingApprovals),
    getCostStatus: () => Promise.resolve(STABLE_COST),
    getKeychainStatus: () => Promise.resolve(STABLE_KEYCHAIN),
    getCostChipPreference: () => Promise.resolve(STABLE_COST_PREFS),
    setCostChipPreference: (enabled) => Promise.resolve({ enabled }),
    getFeatureFlags: () =>
      Promise.resolve({
        show_models_section: false,
        show_all_artifacts_in_spine: false,
        show_roadmap_canvas: false,
        show_recent_reports_v2: false,
        show_chat_v2: false,
      }),
    setFeatureFlag: (name, enabled) =>
      Promise.resolve({
        show_models_section: name === "show_models_section" ? enabled : false,
        show_all_artifacts_in_spine:
          name === "show_all_artifacts_in_spine" ? enabled : false,
        show_roadmap_canvas: name === "show_roadmap_canvas" ? enabled : false,
        show_recent_reports_v2:
          name === "show_recent_reports_v2" ? enabled : false,
        show_chat_v2: name === "show_chat_v2" ? enabled : false,
      }),
    reportFriction: () =>
      Promise.resolve({ friction_id: "frc_stub", local_path: "" }),
    listFriction: () => Promise.resolve([]),
    resolveFriction: () => Promise.resolve(),
    addressFriction: () => Promise.resolve(),
    reopenFriction: () => Promise.resolve(),
    captureViewport: () => Promise.resolve(new Uint8Array()),
    revealInFinder: () => Promise.resolve(),
    onStoreChanged: () => () => {},
    listFindings: () => Promise.resolve([]),
    signalFinding: () => Promise.resolve(),
    listProposals: () => Promise.resolve([]),
    resolveProposal: () => Promise.resolve(),
    signalProposal: () => Promise.resolve(),
    getRoadmap: () =>
      Promise.resolve({
        tree: null,
        parse_error: null,
        claims: [],
        shipments: [],
        source_hash: null,
        roadmap_path: "core-docs/roadmap.md",
      }),
    setNodeStatus: () => Promise.resolve(),
    writeRoadmapDraft: () => Promise.resolve(),
    listRecentReports: () => Promise.resolve([]),
    getReportsUnreadCount: () => Promise.resolve(0),
    markReportsRead: () => Promise.resolve(0),
  };
}

export const inboxFixtureOverrides: VisualIpcOverrides = {
  artifacts: fixtureInboxArtifacts,
  payloads: INBOX_PAYLOADS,
};
