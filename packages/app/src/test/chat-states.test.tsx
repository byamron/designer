import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceThread } from "../tabs/WorkspaceThread";
import { __setIpcClient, ipcClient, type IpcClient } from "../ipc/client";
import { createMockCore, type MockCore } from "../ipc/mock";
import type { ArtifactSummary, Workspace } from "../ipc/types";

/**
 * B7 — visible activity feedback. The thread surface emits a
 * `data-activity` attribute and an ActivityIndicator child whose
 * `data-state` is "submitting" while waiting for the agent's first
 * reply, and "stuck" after the 15-second timeout. Both phases clear
 * when an agent-authored artifact lands.
 *
 * B14 — the send button disables while the dispatch is in flight.
 * B17 — the textarea exposes aria-busy while in flight.
 */

function makeClient(mock: MockCore, ws: Workspace): IpcClient {
  return {
    listProjects: () => Promise.resolve(mock.listProjects()),
    createProject: (req) => Promise.resolve(mock.createProject(req)),
    listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
    createWorkspace: (req) => Promise.resolve(mock.createWorkspace(req)),
    openTab: (req) => Promise.resolve(mock.openTab(req)),
    closeTab: (w, t) => Promise.resolve(mock.closeTab(w, t)),
    spine: (id) => Promise.resolve(mock.spine(id)),
    stream: (h) => mock.subscribe(h),
    requestApproval: (w, g, s) =>
      Promise.resolve(mock.requestApproval(w, g, s)),
    resolveApproval: (id, granted, reason) =>
      Promise.resolve(mock.resolveApproval(id, granted, reason)),
    listArtifacts: (w) => Promise.resolve(mock.listArtifacts(w)),
    listArtifactsInTab: (w, t) => Promise.resolve(mock.listArtifactsInTab(w, t)),
    listSpineArtifacts: (w) => Promise.resolve(mock.listSpineArtifacts(w)),
    listPinnedArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
    getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
    togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
    postMessage: (req) => Promise.resolve(mock.postMessage(req)),
    linkRepo: () => Promise.resolve(),
    unlinkRepo: () => Promise.resolve(),
    startTrack: (req) => Promise.resolve(mock.startTrack(req)),
    requestMerge: (req) => Promise.resolve(mock.requestMerge(req)),
    listTracks: (w) => Promise.resolve(mock.listTracks(w)),
    getTrack: (id) => Promise.resolve(mock.getTrack(id)),
    listPendingApprovals: () => Promise.resolve([]),
    getCostStatus: () =>
      Promise.resolve({
        workspace_id: ws.id,
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
        message: "",
      }),
    getCostChipPreference: () => Promise.resolve({ enabled: false }),
    setCostChipPreference: (enabled) => Promise.resolve({ enabled }),
    getFeatureFlags: () =>
      Promise.resolve({
        show_models_section: false,
        show_all_artifacts_in_spine: false,
      }),
    setFeatureFlag: (name, enabled) =>
      Promise.resolve({
        show_models_section: name === "show_models_section" ? enabled : false,
        show_all_artifacts_in_spine:
          name === "show_all_artifacts_in_spine" ? enabled : false,
      }),
    reportFriction: () =>
      Promise.resolve({ friction_id: "f", local_path: "" }),
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
  };
}

describe("WorkspaceThread activity model (B7, B14, B17)", () => {
  let originalClient: IpcClient;
  let mock: MockCore;
  let workspace: Workspace;

  beforeEach(() => {
    originalClient = ipcClient();
    mock = createMockCore();
    const project = mock.listProjects()[0];
    workspace = mock.listWorkspaces(project.project.id)[0].workspace;
  });

  afterEach(() => {
    __setIpcClient(originalClient);
    vi.useRealTimers();
  });

  // T12 — the send button disables while a dispatch is in flight.
  it("disables the send button while postMessage is in flight (B14)", async () => {
    let resolvePost!: () => void;
    const slowClient: IpcClient = {
      ...makeClient(mock, workspace),
      postMessage: vi.fn(
        () =>
          new Promise<{ artifact_id: string }>((r) => {
            resolvePost = () => r({ artifact_id: "a1" });
          }),
      ),
    };
    __setIpcClient(slowClient);

    render(<WorkspaceThread workspace={workspace} />);
    const ta = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    fireEvent.change(ta!, { target: { value: "go" } });

    const sendBtn = document.querySelector<HTMLButtonElement>(
      ".btn-icon--primary",
    )!;
    expect(sendBtn.disabled).toBe(false);

    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(sendBtn.disabled).toBe(true);
      expect(sendBtn.getAttribute("aria-busy")).toBe("true");
    });

    resolvePost();
    await waitFor(() => {
      expect(sendBtn.disabled).toBe(false);
    });
  });

  // T13 — the compose form (not the textarea itself) exposes
  // aria-busy while in flight. Using aria-busy on the textarea is
  // semantically wrong: it implies the contents are not yet ready,
  // when actually the user can keep editing a follow-up draft. The
  // form-level signal communicates "submit is in progress" without
  // hiding the input from AT.
  it("sets aria-busy on the compose form while in flight (B17)", async () => {
    let resolvePost!: () => void;
    const slowClient: IpcClient = {
      ...makeClient(mock, workspace),
      postMessage: vi.fn(
        () =>
          new Promise<{ artifact_id: string }>((r) => {
            resolvePost = () => r({ artifact_id: "a1" });
          }),
      ),
    };
    __setIpcClient(slowClient);

    render(<WorkspaceThread workspace={workspace} />);
    const ta = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    fireEvent.change(ta!, { target: { value: "hi" } });

    const form = document.querySelector<HTMLFormElement>("form.compose")!;

    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".btn-icon--primary")!,
    );

    await waitFor(() => {
      expect(form.getAttribute("aria-busy")).toBe("true");
    });
    // Textarea must NOT be marked busy — the user can type ahead.
    expect(ta!.getAttribute("aria-busy")).toBeNull();

    resolvePost();
    await waitFor(() => {
      expect(form.getAttribute("aria-busy")).not.toBe("true");
    });
  });

  // T9 — submitting indicator appears immediately after the user
  // clicks send and remains until the agent's first reply lands.
  it("flips data-activity='submitting' on send and clears when an agent artifact arrives", async () => {
    __setIpcClient(makeClient(mock, workspace));
    render(<WorkspaceThread workspace={workspace} />);

    const ta = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    fireEvent.change(ta!, { target: { value: "ping" } });
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".btn-icon--primary")!,
    );

    // Mock postMessage synchronously appends both a user artifact and
    // an agent reply, so the activity should briefly flip to
    // submitting and then back to idle once the refresh finishes.
    await waitFor(() => {
      const root = document.querySelector<HTMLElement>(
        '[data-component="WorkspaceThread"]',
      );
      expect(root?.getAttribute("data-activity")).toBe("idle");
    });
  });

  // T11 — without any agent reply, the indicator transitions to
  // "stuck" after 15 seconds.
  it("flips to data-activity='stuck' after STUCK_AFTER_MS without an agent reply", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });

    let resolvePost!: () => void;
    const stalledClient: IpcClient = {
      ...makeClient(mock, workspace),
      // Stall postMessage forever — and by not pushing an agent
      // artifact, we simulate "the subprocess took the message but
      // never replied".
      postMessage: vi.fn(
        () =>
          new Promise<{ artifact_id: string }>((r) => {
            resolvePost = () => r({ artifact_id: "stalled" });
          }),
      ),
    };
    __setIpcClient(stalledClient);

    render(<WorkspaceThread workspace={workspace} />);
    const ta = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    fireEvent.change(ta!, { target: { value: "ping" } });
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".btn-icon--primary")!,
    );

    await waitFor(() => {
      expect(
        document
          .querySelector('[data-component="WorkspaceThread"]')
          ?.getAttribute("data-activity"),
      ).toBe("submitting");
    });

    // Advance past the stuck threshold.
    await vi.advanceTimersByTimeAsync(15_500);

    await waitFor(() => {
      expect(
        document
          .querySelector('[data-component="WorkspaceThread"]')
          ?.getAttribute("data-activity"),
      ).toBe("stuck");
    });

    const indicator = document.querySelector(
      '[data-component="ActivityIndicator"]',
    );
    expect(indicator?.getAttribute("data-state")).toBe("stuck");
    expect(indicator?.textContent ?? "").toMatch(/still working/i);

    resolvePost();
  });
});
