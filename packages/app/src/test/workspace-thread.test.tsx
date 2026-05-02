import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { WorkspaceThread } from "../tabs/WorkspaceThread";
import { __setIpcClient, ipcClient, type IpcClient } from "../ipc/client";
import { createMockCore, type MockCore } from "../ipc/mock";
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
      openTab: (req) => Promise.resolve(mock.openTab(req)),
      closeTab: (ws, t) => Promise.resolve(mock.closeTab(ws, t)),
      spine: (id) => Promise.resolve(mock.spine(id)),
      stream: (handler) => mock.subscribe(handler),
      requestApproval: (ws, gate, summary) =>
        Promise.resolve(mock.requestApproval(ws, gate, summary)),
      resolveApproval: (id, granted, reason) =>
        Promise.resolve(mock.resolveApproval(id, granted, reason)),
      listArtifacts: (ws) => Promise.resolve(mock.listArtifacts(ws)),
      listPinnedArtifacts: (ws) =>
        Promise.resolve(mock.listPinnedArtifacts(ws)),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      postMessage: (req) => Promise.resolve(mock.postMessage(req)),
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
      getFeatureFlags: () => Promise.resolve({ show_models_section: false }),
      setFeatureFlag: (_name, enabled) => Promise.resolve({ show_models_section: enabled }),
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
    fireEvent.change(textarea!, { target: { value: "Build a sequence diagram" } });

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

  it("restores the draft and surfaces an alert when postMessage rejects", async () => {
    const failClient: IpcClient = {
      ...originalClient,
      listProjects: () => Promise.resolve(mock.listProjects()),
      listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
      spine: (id) => Promise.resolve(mock.spine(id)),
      stream: (handler) => mock.subscribe(handler),
      listArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      listPinnedArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      // Reject with the production-shaped IpcError envelope.
      postMessage: () =>
        Promise.reject({ kind: "cost_cap_exceeded", message: "$10 cap" }),
    } as IpcClient;
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
    const slowMock: IpcClient = {
      ...originalClient,
      listProjects: () => Promise.resolve(mock.listProjects()),
      listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
      spine: (id) => Promise.resolve(mock.spine(id)),
      stream: (handler) => mock.subscribe(handler),
      listArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      listPinnedArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      postMessage: vi.fn(() => firstPromise),
    } as IpcClient;
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
      expect((slowMock.postMessage as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(1),
    );

    // Resolve to clean up.
    await act(async () => {
      resolveFirst({ artifact_id: "x" });
    });
  });

  it("refreshes when a production-shape stream_id (`workspace:<uuid>`) artifact event arrives", async () => {
    let captured: ((e: StreamEvent) => void) | null = null;
    const customMock: IpcClient = {
      ...originalClient,
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
      listArtifacts: vi.fn(() => Promise.resolve([] as ArtifactSummary[])),
      listPinnedArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      postMessage: (req) => Promise.resolve(mock.postMessage(req)),
    } as IpcClient;
    __setIpcClient(customMock);

    render(<WorkspaceThread workspace={workspace} />);

    // Wait for initial mount-time refresh so the call count starts known.
    await waitFor(() => expect(captured).not.toBeNull());
    const initialCalls = (customMock.listArtifacts as unknown as { mock: { calls: unknown[] } }).mock.calls.length;

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
      const after = (customMock.listArtifacts as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
      expect(after).toBeGreaterThan(initialCalls);
    });
  });
});
