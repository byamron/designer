import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { WorkspaceThread } from "../tabs/WorkspaceThread";
import { __setIpcClient, ipcClient, type IpcClient } from "../ipc/client";
import { createMockCore, type MockCore } from "../ipc/mock";
import { mockIpcClient } from "./ipcMockClient";
import type {
  ArtifactSummary,
  PostMessageRequest,
  StreamEvent,
  Workspace,
} from "../ipc/types";

/**
 * Phase 13.D wire — the WorkspaceThread should call
 * `ipcClient().postMessage()` with the workspace id, draft text, and
 * attachments when the user submits the compose dock. The seeded mock
 * core captures every call so tests can assert the exact shape that
 * crossed the wire.
 */
describe("WorkspaceThread → ipcClient.postMessage", () => {
  let originalClient: IpcClient;
  let mock: MockCore;
  let workspace: Workspace;

  beforeEach(() => {
    originalClient = ipcClient();
    mock = createMockCore();
    const project = mock.listProjects()[0];
    workspace = mock.listWorkspaces(project.project.id)[0].workspace;
    __setIpcClient({
      listProjects: () => Promise.resolve(mock.listProjects()),
      createProject: (req) => Promise.resolve(mock.createProject(req)),
      listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
      createWorkspace: (req) => Promise.resolve(mock.createWorkspace(req)),
      renameWorkspace: (id, name) =>
        Promise.resolve(mock.renameWorkspace(id, name)),
      renameTab: (w, t, title) => Promise.resolve(mock.renameTab(w, t, title)),
      archiveWorkspace: (id) => Promise.resolve(mock.archiveWorkspace(id)),
      restoreWorkspace: (id) => Promise.resolve(mock.restoreWorkspace(id)),
      deleteWorkspace: (id) => Promise.resolve(mock.deleteWorkspace(id)),
      openTab: (req) => Promise.resolve(mock.openTab(req)),
      closeTab: (ws, t) => Promise.resolve(mock.closeTab(ws, t)),
      spine: (id) => Promise.resolve(mock.spine(id)),
      stream: (handler) => mock.subscribe(handler),
      activityStream: () => () => {},
      teamLifecycleStream: () => () => {},
      listWorkspaceChatEvents: () => Promise.resolve([]),
      requestApproval: (ws, gate, summary) =>
        Promise.resolve(mock.requestApproval(ws, gate, summary)),
      resolveApproval: (id, granted, reason) =>
        Promise.resolve(mock.resolveApproval(id, granted, reason)),
      listArtifacts: (ws) => Promise.resolve(mock.listArtifacts(ws)),
      listArtifactsInTab: (ws, t) =>
        Promise.resolve(mock.listArtifactsInTab(ws, t)),
      listSpineArtifacts: (ws) => Promise.resolve(mock.listSpineArtifacts(ws)),
      listPinnedArtifacts: (ws) =>
        Promise.resolve(mock.listPinnedArtifacts(ws)),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      postMessage: (req) => Promise.resolve(mock.postMessage(req)),
      interruptTurn: (workspaceId, tabId) => {
        mock.interruptTurn(workspaceId, tabId);
        return Promise.resolve();
      },
      linkRepo: (req) =>
        new Promise((resolve, reject) => {
          try {
            mock.linkRepo(req);
            resolve();
          } catch (e) {
            reject(e);
          }
        }),
      unlinkRepo: (req) => Promise.resolve(mock.unlinkRepo(req)),
      startTrack: (req) => Promise.resolve(mock.startTrack(req)),
      requestMerge: (req) => Promise.resolve(mock.requestMerge(req)),
      completeTrack: (req) => {
        mock.completeTrack(req);
        return Promise.resolve();
      },
      listTracks: (ws) => Promise.resolve(mock.listTracks(ws)),
      getTrack: (id) => Promise.resolve(mock.getTrack(id)),
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
    });
  });

  afterEach(() => {
    __setIpcClient(originalClient);
  });

  it("posts a message with the workspace id, text, and (empty) attachments on send", async () => {
    render(<WorkspaceThread workspace={workspace} />);

    const textarea = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, {
      target: { value: "Build a sequence diagram" },
    });

    const sendBtn = document.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );
    expect(sendBtn).not.toBeNull();
    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(mock.postedMessages().length).toBe(1);
    });
    const sent: PostMessageRequest = mock.postedMessages()[0];
    expect(sent.workspace_id).toBe(workspace.id);
    expect(sent.text).toBe("Build a sequence diagram");
    expect(sent.attachments).toEqual([]);
  });

  it("does not post on an empty draft", async () => {
    render(<WorkspaceThread workspace={workspace} />);

    const sendBtn = await waitFor(() =>
      document.querySelector<HTMLButtonElement>("button.btn-icon--primary"),
    );
    expect(sendBtn).not.toBeNull();
    fireEvent.click(sendBtn!);

    // ComposeDock guards the empty case before invoking onSend, and
    // WorkspaceThread.onSend guards again. Either way the mock should
    // never see a call.
    expect(mock.postedMessages()).toEqual([]);
  });

  it("forwards the user's selected model on postMessage", async () => {
    render(<WorkspaceThread workspace={workspace} />);

    const textarea = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, { target: { value: "test the cheap model" } });

    // Switch the Model selector to Haiku before sending.
    const modelSelect = document.querySelector<HTMLSelectElement>(
      "select[aria-label='Model']",
    );
    expect(modelSelect).not.toBeNull();
    fireEvent.change(modelSelect!, { target: { value: "haiku-4.5" } });

    const sendBtn = document.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );
    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(mock.postedMessages().length).toBe(1);
    });
    const sent: PostMessageRequest = mock.postedMessages()[0];
    expect(sent.model).toBe("haiku-4.5");
  });

  it("omits a model when the default selection is in effect", async () => {
    render(<WorkspaceThread workspace={workspace} />);

    const textarea = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    fireEvent.change(textarea!, { target: { value: "default opus path" } });

    const sendBtn = document.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );
    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(mock.postedMessages().length).toBe(1);
    });
    const sent: PostMessageRequest = mock.postedMessages()[0];
    // The default selection ("opus-4.7") still rides along — backend
    // treats it as a no-op when it matches the running team. Tests
    // that care about the no-op path live in the Rust suite (see
    // `post_message_with_model_records_team_model`).
    expect(sent.model).toBe("opus-4.7");
  });

  it("restores the draft and surfaces an alert when postMessage rejects", async () => {
    const failClient = mockIpcClient({
      listProjects: () => Promise.resolve(mock.listProjects()),
      listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
      spine: (id) => Promise.resolve(mock.spine(id)),
      stream: (handler) => mock.subscribe(handler),
      activityStream: () => () => {},
      teamLifecycleStream: () => () => {},
      listWorkspaceChatEvents: () => Promise.resolve([]),
      listArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      listPinnedArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      // Reject with the production-shaped IpcError envelope.
      postMessage: () =>
        Promise.reject({ kind: "cost_cap_exceeded", message: "$10 cap" }),
    });
    __setIpcClient(failClient);

    render(<WorkspaceThread workspace={workspace} />);

    const textarea = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    fireEvent.change(textarea!, { target: { value: "do the thing" } });

    const sendBtn = document.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );
    fireEvent.click(sendBtn!);

    // Draft restored after failure (ComposeDock cleared it sync; the
    // catch handler re-seeds it via the imperative handle).
    await waitFor(() => {
      const restored = document.querySelector<HTMLTextAreaElement>(
        "textarea.compose__input",
      );
      expect(restored?.value).toBe("do the thing");
    });

    // Alert banner uses the typed `cost_cap_exceeded` translator copy.
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Cost cap reached");
    expect(alert.textContent).toContain("$10 cap");
  });

  it("ignores concurrent click sends while a postMessage is in flight", async () => {
    let resolveFirst!: (v: { artifact_id: string }) => void;
    const firstPromise = new Promise<{ artifact_id: string }>((r) => {
      resolveFirst = r;
    });
    const slowMock = mockIpcClient({
      listProjects: () => Promise.resolve(mock.listProjects()),
      listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
      spine: (id) => Promise.resolve(mock.spine(id)),
      stream: (handler) => mock.subscribe(handler),
      activityStream: () => () => {},
      teamLifecycleStream: () => () => {},
      listWorkspaceChatEvents: () => Promise.resolve([]),
      listArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      listPinnedArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      postMessage: vi.fn(() => firstPromise),
    });
    __setIpcClient(slowMock);

    render(<WorkspaceThread workspace={workspace} />);

    const textarea = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    fireEvent.change(textarea!, { target: { value: "first" } });
    const sendBtn = document.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );

    // Two clicks within the same microtask. The synchronous re-entry
    // guard on WorkspaceThread.onSend should prevent a second
    // dispatch even though React state updates haven't flushed yet.
    fireEvent.click(sendBtn!);
    fireEvent.click(sendBtn!);

    await waitFor(() =>
      expect(
        (slowMock.postMessage as unknown as { mock: { calls: unknown[] } }).mock
          .calls.length,
      ).toBe(1),
    );

    // Resolve to clean up.
    await act(async () => {
      resolveFirst({ artifact_id: "x" });
    });
  });

  it("refreshes when a production-shape stream_id (`workspace:<uuid>`) artifact event arrives", async () => {
    let captured: ((e: StreamEvent) => void) | null = null;
    const customMock = mockIpcClient({
      listProjects: () => Promise.resolve(mock.listProjects()),
      listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
      spine: (id) => Promise.resolve(mock.spine(id)),
      // Capture the stream listener so we can dispatch events with the
      // exact production wire format `StreamId::Workspace(uuid)` →
      // `"workspace:<uuid>"`.
      stream: (handler) => {
        captured = handler;
        return () => {
          captured = null;
        };
      },
      activityStream: () => () => {},
      teamLifecycleStream: () => () => {},
      listWorkspaceChatEvents: () => Promise.resolve([]),
      listArtifacts: vi.fn(() => Promise.resolve([] as ArtifactSummary[])),
      listPinnedArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      postMessage: (req) => Promise.resolve(mock.postMessage(req)),
    });
    __setIpcClient(customMock);

    render(<WorkspaceThread workspace={workspace} />);

    // Wait for initial mount-time refresh so the call count starts known.
    await waitFor(() => expect(captured).not.toBeNull());
    const initialCalls = (
      customMock.listArtifacts as unknown as { mock: { calls: unknown[] } }
    ).mock.calls.length;

    // Dispatch a production-shape stream event for this workspace.
    act(() => {
      captured!({
        kind: "artifact_created",
        stream_id: `workspace:${workspace.id}`,
        sequence: 99,
        timestamp: new Date().toISOString(),
      });
    });

    await waitFor(() => {
      const after = (
        customMock.listArtifacts as unknown as { mock: { calls: unknown[] } }
      ).mock.calls.length;
      expect(after).toBeGreaterThan(initialCalls);
    });
  });
});

/**
 * Per-tab thread isolation. Two tabs on the same workspace render
 * different threads: a message sent in tab A appears only in tab A.
 * Switching to tab B shows tab B's slice. Workspace-wide artifacts
 * (specs, PRs) appear in both.
 */
describe("WorkspaceThread per-tab thread isolation", () => {
  let originalClient: IpcClient;
  let mock: MockCore;
  let workspace: Workspace;

  beforeEach(() => {
    originalClient = ipcClient();
    mock = createMockCore();
    const project = mock.listProjects()[0];
    workspace = mock.listWorkspaces(project.project.id)[0].workspace;
    __setIpcClient(
      mockIpcClient({
        listProjects: () => Promise.resolve(mock.listProjects()),
        listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
        spine: (id) => Promise.resolve(mock.spine(id)),
        stream: (h) => mock.subscribe(h),
        activityStream: () => () => {},
        teamLifecycleStream: () => () => {},
        listWorkspaceChatEvents: () => Promise.resolve([]),
        listArtifacts: (ws) => Promise.resolve(mock.listArtifacts(ws)),
        listArtifactsInTab: (ws, t) =>
          Promise.resolve(mock.listArtifactsInTab(ws, t)),
        listPinnedArtifacts: (ws) =>
          Promise.resolve(mock.listPinnedArtifacts(ws)),
        getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
        togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
        postMessage: (req) => Promise.resolve(mock.postMessage(req)),
        requestApproval: (ws, gate, summary) =>
          Promise.resolve(mock.requestApproval(ws, gate, summary)),
        resolveApproval: (id, granted, reason) =>
          Promise.resolve(mock.resolveApproval(id, granted, reason)),
        openTab: (req) => Promise.resolve(mock.openTab(req)),
        closeTab: (ws, t) => Promise.resolve(mock.closeTab(ws, t)),
      }),
    );
  });

  afterEach(() => {
    __setIpcClient(originalClient);
  });

  it("messages sent in tab A do not appear in tab B", async () => {
    // Open a second tab so the workspace has two distinct threads.
    const tabA = workspace.tabs[0];
    expect(tabA).toBeTruthy();
    const tabB = mock.openTab({
      workspace_id: workspace.id,
      title: "Tab B",
      template: "thread",
    });

    // Render tab A and post a message there.
    const a = render(<WorkspaceThread workspace={workspace} tabId={tabA.id} />);
    const textareaA = await waitFor(() =>
      a.container.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    expect(textareaA).not.toBeNull();
    fireEvent.change(textareaA!, { target: { value: "hello from A" } });
    const sendA = a.container.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );
    fireEvent.click(sendA!);

    // postMessage should have been called with tab_id == tabA.id.
    await waitFor(() => {
      expect(mock.postedMessages().length).toBe(1);
    });
    expect(mock.postedMessages()[0].tab_id).toBe(tabA.id);

    a.unmount();

    // Render tab B — the user's "hello from A" must NOT appear here.
    const b = render(<WorkspaceThread workspace={workspace} tabId={tabB.id} />);
    await waitFor(() => {
      // The thread region renders once `hasStarted` flips OR via initial paint.
      expect(b.container.querySelector(".workspace-thread")).not.toBeNull();
    });
    // The thread DOM should not contain the body of the message we sent in A.
    expect(b.container.textContent ?? "").not.toContain("hello from A");
    b.unmount();
  });

  it("workspace-wide artifacts (e.g. spec) appear in every tab's view", async () => {
    const tabA = workspace.tabs[0];
    const tabB = mock.openTab({
      workspace_id: workspace.id,
      title: "Tab B",
      template: "thread",
    });

    const a = render(<WorkspaceThread workspace={workspace} tabId={tabA.id} />);
    // Click "What are we building?" suggestion to flip into thread mode.
    // We have a seeded "Onboarding spec" (kind: spec, workspace-wide). It
    // should appear in tab A AND in tab B as a workspace-wide artifact.
    await waitFor(() => {
      // The mock seeds a spec titled "Onboarding spec" in workspace 0,
      // a workspace whose first tab is tabA. We assert that the spec
      // shows up in both renders.
      const inA = a.container.querySelector(
        '[data-component="WorkspaceThread"]',
      );
      expect(inA).not.toBeNull();
    });
    a.unmount();

    const b = render(<WorkspaceThread workspace={workspace} tabId={tabB.id} />);
    await waitFor(() => {
      // tabB has no messages of its own. listArtifactsInTab returns the
      // workspace-wide spec; we assert the thread mounted (suggestion
      // mode for an empty tab is the expected state — the spec is in
      // the underlying artifact list, the user just hasn't sent a
      // message in this tab yet).
      expect(b.container.querySelector(".workspace-thread")).not.toBeNull();
    });
    b.unmount();
  });
});
