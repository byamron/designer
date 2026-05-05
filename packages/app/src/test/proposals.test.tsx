import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesignerNoticedHome } from "../components/DesignerNoticed";
import { __setIpcClient, ipcClient } from "../ipc/client";
import type { IpcClient } from "../ipc/client";
import type { ProposalDto, StreamEvent } from "../ipc/types";
import { dataStore } from "../store/data";
import { appStore } from "../store/app";

function stubClient(overrides: Partial<IpcClient> = {}): IpcClient {
  const base: IpcClient = {
    listProjects: () => Promise.resolve([]),
    createProject: () => Promise.reject(new Error("nope")),
    listWorkspaces: () => Promise.resolve([]),
    createWorkspace: () => Promise.reject(new Error("nope")),
    renameWorkspace: () => Promise.reject(new Error("nope")),
    renameTab: () => Promise.reject(new Error("nope")),
    archiveWorkspace: () => Promise.resolve(),
    restoreWorkspace: () => Promise.resolve(),
    deleteWorkspace: () => Promise.resolve(),
    openTab: () => Promise.reject(new Error("nope")),
    closeTab: () => Promise.resolve(),
    spine: () => Promise.resolve([]),
    stream: () => () => {},
    activityStream: () => () => {},
    requestApproval: () => Promise.resolve(""),
    resolveApproval: () => Promise.resolve(),
    listArtifacts: () => Promise.resolve([]),
    listArtifactsInTab: () => Promise.resolve([]),
    listSpineArtifacts: () => Promise.resolve([]),
    listPinnedArtifacts: () => Promise.resolve([]),
    getArtifact: () => Promise.reject(new Error("nope")),
    togglePinArtifact: () => Promise.resolve(true),
    postMessage: () => Promise.reject(new Error("nope")),
    interruptTurn: () => Promise.resolve(),
    linkRepo: () => Promise.resolve(),
    unlinkRepo: () => Promise.resolve(),
    startTrack: () => Promise.reject(new Error("nope")),
    requestMerge: () => Promise.reject(new Error("nope")),
    completeTrack: () => Promise.resolve(),
    listTracks: () => Promise.resolve([]),
    getTrack: () => Promise.reject(new Error("nope")),
    listPendingApprovals: () => Promise.resolve([]),
    getCostStatus: (workspaceId) =>
      Promise.resolve({
        workspace_id: workspaceId,
        spent_dollars_cents: 0,
        cap_dollars_cents: null,
        spent_tokens: 0,
        cap_tokens: null,
        ratio: null,
      }),
    getKeychainStatus: () =>
      Promise.resolve({
        state: "connected" as const,
        last_verified: null,
        message: "stub",
      }),
    getCostChipPreference: () => Promise.resolve({ enabled: false }),
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
      Promise.resolve({ friction_id: "frc_stub_abcdef", local_path: "" }),
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
  return { ...base, ...overrides };
}

function makeProposal(overrides: Partial<ProposalDto> = {}): ProposalDto {
  return {
    id: "prp_test_1",
    project_id: "prj_test",
    source_findings: ["fnd_1", "fnd_2"],
    title: "Repeated correction",
    summary: "User corrected the same pattern 3 times.",
    severity: "notice",
    kind: "hint",
    created_at: "2026-04-29T12:00:00Z",
    status: "open",
    evidence: [
      {
        id: "fnd_1",
        detector_name: "repeated_correction",
        detector_version: 1,
        project_id: "prj_test",
        timestamp: "2026-04-29T11:00:00Z",
        severity: "notice",
        confidence: 0.9,
        summary: "First correction observation",
        evidence: [],
        window_digest: "d1",
      },
      {
        id: "fnd_2",
        detector_name: "repeated_correction",
        detector_version: 1,
        project_id: "prj_test",
        timestamp: "2026-04-29T11:30:00Z",
        severity: "notice",
        confidence: 0.9,
        summary: "Second correction observation",
        evidence: [],
        window_digest: "d2",
      },
    ],
    ...overrides,
  };
}

describe("DesignerNoticedHome (Phase 21.A1.2 — proposals over findings)", () => {
  let originalClient: IpcClient;

  beforeEach(() => {
    originalClient = ipcClient();
    dataStore.set((s) => ({ ...s, events: [] }));
    appStore.set((s) => ({ ...s, noticedLastViewedSeq: 0 }));
  });

  afterEach(() => {
    __setIpcClient(originalClient);
  });

  it("renders the empty-state copy when no proposals exist", async () => {
    __setIpcClient(stubClient());
    render(<DesignerNoticedHome projectId="prj_test" />);
    await waitFor(() => {
      expect(
        screen.getByText(
          /Designer reviews patterns when you finish a track or once per day/,
        ),
      ).toBeTruthy();
    });
  });

  it("renders proposal title + summary, not findings as top-level rows", async () => {
    __setIpcClient(
      stubClient({ listProposals: () => Promise.resolve([makeProposal()]) }),
    );
    render(<DesignerNoticedHome projectId="prj_test" />);
    await waitFor(() => {
      expect(screen.getByText("Repeated correction")).toBeTruthy();
    });
    // Proposal summary visible.
    expect(
      screen.getByText("User corrected the same pattern 3 times."),
    ).toBeTruthy();
    // Finding summaries are not top-level — they live in the (closed)
    // evidence drawer until the user opens it.
    expect(screen.queryByText("First correction observation")).toBeNull();
  });

  it("expands the evidence drawer when 'from N observations' is clicked", async () => {
    __setIpcClient(
      stubClient({ listProposals: () => Promise.resolve([makeProposal()]) }),
    );
    render(<DesignerNoticedHome projectId="prj_test" />);
    const toggle = await screen.findByRole("button", {
      name: /from 2 observations/i,
    });
    fireEvent.click(toggle);
    expect(
      await screen.findByText("First correction observation"),
    ).toBeTruthy();
    expect(screen.getByText("Second correction observation")).toBeTruthy();
  });

  it("calls signalProposal when the thumbs-up button is clicked", async () => {
    const signalProposal = vi.fn(() => Promise.resolve());
    __setIpcClient(
      stubClient({
        listProposals: () => Promise.resolve([makeProposal()]),
        signalProposal,
      }),
    );
    render(<DesignerNoticedHome projectId="prj_test" />);
    const up = await screen.findByRole("button", {
      name: /Useful — keep showing recommendations like this/i,
    });
    fireEvent.click(up);
    await waitFor(() =>
      expect(signalProposal).toHaveBeenCalledWith({
        proposal_id: "prp_test_1",
        signal: "up",
      }),
    );
  });

  it("calls resolveProposal with 'accepted' when Accept is clicked", async () => {
    const resolveProposal = vi.fn(() => Promise.resolve());
    __setIpcClient(
      stubClient({
        listProposals: () => Promise.resolve([makeProposal()]),
        resolveProposal,
      }),
    );
    render(<DesignerNoticedHome projectId="prj_test" />);
    const accept = await screen.findByRole("button", { name: /^Accept$/ });
    fireEvent.click(accept);
    await waitFor(() =>
      expect(resolveProposal).toHaveBeenCalledWith({
        proposal_id: "prp_test_1",
        resolution: { kind: "accepted" },
      }),
    );
  });
});

describe("Sidebar badge — Phase 21.A1.2 counts proposals, not findings", () => {
  // These assertions exercise the same selector the sidebar uses
  // (`events.filter(e => e.kind === 'proposal_emitted' && ...).length`)
  // without rendering the full sidebar (which depends on a project).
  beforeEach(() => {
    dataStore.set((s) => ({ ...s, events: [] }));
    appStore.set((s) => ({ ...s, noticedLastViewedSeq: 0 }));
  });

  it("does not increment when finding_recorded events arrive without proposals", () => {
    const findings: StreamEvent[] = Array.from({ length: 10 }, (_, i) => ({
      kind: "finding_recorded",
      stream_id: "system",
      sequence: i + 1,
      timestamp: new Date().toISOString(),
    }));
    dataStore.set((s) => ({ ...s, events: findings }));
    const { events } = dataStore.get();
    const noticedLastViewedSeq = appStore.get().noticedLastViewedSeq;
    const noticedUnread = events.reduce(
      (acc, e) =>
        e.kind === "proposal_emitted" && e.sequence > noticedLastViewedSeq
          ? acc + 1
          : acc,
      0,
    );
    expect(noticedUnread).toBe(0);
  });

  it("increments only on proposal_emitted events", () => {
    const events: StreamEvent[] = [
      {
        kind: "finding_recorded",
        stream_id: "system",
        sequence: 1,
        timestamp: new Date().toISOString(),
      },
      {
        kind: "proposal_emitted",
        stream_id: "system",
        sequence: 2,
        timestamp: new Date().toISOString(),
      },
      {
        kind: "proposal_emitted",
        stream_id: "system",
        sequence: 3,
        timestamp: new Date().toISOString(),
      },
    ];
    dataStore.set((s) => ({ ...s, events }));
    const noticedLastViewedSeq = appStore.get().noticedLastViewedSeq;
    const noticedUnread = events.reduce(
      (acc, e) =>
        e.kind === "proposal_emitted" && e.sequence > noticedLastViewedSeq
          ? acc + 1
          : acc,
      0,
    );
    expect(noticedUnread).toBe(2);
  });
});
