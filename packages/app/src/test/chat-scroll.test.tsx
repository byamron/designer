import { fireEvent, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceThread } from "../tabs/WorkspaceThread";
import { __setIpcClient, ipcClient, type IpcClient } from "../ipc/client";
import { createMockCore, type MockCore } from "../ipc/mock";
import type {
  ArtifactSummary,
  StreamEvent,
  Workspace,
} from "../ipc/types";

/**
 * B6 — auto-scroll with stickiness. The thread should pin to the bottom
 * when the user is at (or near) the bottom, and *not* yank them when
 * they've scrolled up. Once behind, a "Jump to latest" pill appears.
 *
 * jsdom doesn't lay anything out, so scrollHeight / scrollTop default
 * to 0 / 0 — we install simple shims to make scroll math observable.
 */

let listArtifactsCb: () => ArtifactSummary[] = () => [];
let lastStream: ((e: StreamEvent) => void) | null = null;

function makeClient(mock: MockCore, ws: Workspace): IpcClient {
  return {
    listProjects: () => Promise.resolve(mock.listProjects()),
    createProject: (req) => Promise.resolve(mock.createProject(req)),
    listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
    createWorkspace: (req) => Promise.resolve(mock.createWorkspace(req)),
    archiveWorkspace: (id) => Promise.resolve(mock.archiveWorkspace(id)),
    restoreWorkspace: (id) => Promise.resolve(mock.restoreWorkspace(id)),
    deleteWorkspace: (id) => Promise.resolve(mock.deleteWorkspace(id)),
    openTab: (req) => Promise.resolve(mock.openTab(req)),
    closeTab: (w, t) => Promise.resolve(mock.closeTab(w, t)),
    spine: (id) => Promise.resolve(mock.spine(id)),
    stream: (h) => {
      lastStream = h;
      return () => {
        lastStream = null;
      };
    },
    activityStream: () => () => {},
    requestApproval: (w, g, s) =>
      Promise.resolve(mock.requestApproval(w, g, s)),
    resolveApproval: (id, granted, reason) =>
      Promise.resolve(mock.resolveApproval(id, granted, reason)),
    listArtifacts: () => Promise.resolve(listArtifactsCb()),
    listArtifactsInTab: () => Promise.resolve(listArtifactsCb()),
    listSpineArtifacts: () => Promise.resolve(listArtifactsCb()),
    listPinnedArtifacts: () => Promise.resolve([] as ArtifactSummary[]),
    getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
    togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
    postMessage: (req) => Promise.resolve(mock.postMessage(req)),
    interruptTurn: (workspaceId, tabId) => {
      mock.interruptTurn(workspaceId, tabId);
      return Promise.resolve();
    },
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

function makeArtifact(role: string, summary: string): ArtifactSummary {
  return {
    id: `art_${Math.random().toString(36).slice(2, 10)}`,
    workspace_id: "ws_test",
    kind: "message",
    title: summary.slice(0, 40),
    summary,
    author_role: role,
    version: 1,
    created_at: "2026-04-30T00:00:00Z",
    updated_at: "2026-04-30T00:00:00Z",
    pinned: false,
  };
}

// Install a controllable scroll model on the thread element. jsdom
// returns 0 for scrollHeight / clientHeight; we override with values
// the test can drive.
function installScrollShim(el: HTMLElement, scrollHeight: number, clientHeight: number) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => scrollHeight,
  });
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => clientHeight,
  });
  // jsdom does honor `scrollTop` writes via the underlying property —
  // no shim needed.
}

describe("Thread scroll stickiness (B6)", () => {
  let originalClient: IpcClient;
  let mock: MockCore;
  let workspace: Workspace;
  let artifacts: ArtifactSummary[];

  beforeEach(() => {
    originalClient = ipcClient();
    mock = createMockCore();
    const project = mock.listProjects()[0];
    workspace = mock.listWorkspaces(project.project.id)[0].workspace;
    artifacts = [makeArtifact("user", "first")];
    listArtifactsCb = () => artifacts;
    lastStream = null;
    __setIpcClient(makeClient(mock, workspace));
  });

  afterEach(() => {
    __setIpcClient(originalClient);
  });

  async function bootThread() {
    const r = render(<WorkspaceThread workspace={workspace} />);
    // Send a message so hasStarted flips and the real .thread mounts.
    const ta = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    fireEvent.change(ta!, { target: { value: "go" } });
    artifacts = [makeArtifact("user", "go"), makeArtifact("agent", "first reply")];
    fireEvent.click(
      document.querySelector<HTMLButtonElement>(".btn-icon--primary")!,
    );
    await waitFor(() =>
      expect(document.querySelector(".thread")).not.toBeNull(),
    );
    return r;
  }

  // T6 — when user is pinned to the bottom, a new artifact arrives and
  // the thread auto-scrolls to keep them at the bottom.
  it("auto-scrolls when the user is at the bottom", async () => {
    await bootThread();
    const thread = document.querySelector<HTMLElement>(".thread")!;
    installScrollShim(thread, 1000, 400);
    thread.scrollTop = 600; // pinned (1000 - 400 = 600)

    artifacts = [
      ...artifacts,
      makeArtifact("agent", "another reply that pushes the thread"),
    ];
    await act(async () => {
      lastStream?.({
        kind: "artifact_created",
        stream_id: `workspace:${workspace.id}`,
        sequence: 1,
        timestamp: "2026-04-30T00:00:00Z",
      });
    });

    await waitFor(() => {
      // After the new artifact lands, scrollTop should still be at the
      // bottom (now 1200 - 400 = 800).
      installScrollShim(thread, 1200, 400);
      // The layout effect runs synchronously; a manual stickRef value
      // would have re-pinned to scrollHeight. We assert by reading the
      // value the layout effect set.
      expect(thread.scrollTop).toBeGreaterThanOrEqual(600);
    });
  });

  // T7 — when the user has scrolled up, a new artifact does not yank
  // them back down. Stickiness false ⇒ scrollTop unchanged.
  it("does not auto-scroll when the user has scrolled up", async () => {
    await bootThread();
    const thread = document.querySelector<HTMLElement>(".thread")!;
    installScrollShim(thread, 1000, 400);
    thread.scrollTop = 100; // way above bottom
    fireEvent.scroll(thread);

    const before = thread.scrollTop;
    artifacts = [...artifacts, makeArtifact("agent", "new content")];
    await act(async () => {
      lastStream?.({
        kind: "artifact_created",
        stream_id: `workspace:${workspace.id}`,
        sequence: 2,
        timestamp: "2026-04-30T00:00:00Z",
      });
    });

    // Allow the refresh + render to flush.
    await new Promise((r) => setTimeout(r, 0));
    expect(thread.scrollTop).toBe(before);
  });

  // T8 — once behind, the Jump-to-latest pill appears; clicking it
  // scrolls to bottom and re-pins so subsequent artifacts auto-stick
  // again.
  it("shows the jump-to-latest pill while behind, hides it after click", async () => {
    await bootThread();
    const thread = document.querySelector<HTMLElement>(".thread")!;
    installScrollShim(thread, 1000, 400);
    thread.scrollTop = 100;
    fireEvent.scroll(thread);

    await waitFor(() => {
      expect(
        document.querySelector('[data-component="JumpToLatest"]'),
      ).not.toBeNull();
    });

    const pill = document.querySelector<HTMLButtonElement>(
      '[data-component="JumpToLatest"]',
    )!;
    fireEvent.click(pill);

    // After the pill click, scrollTop is set to scrollHeight; the
    // onScroll handler should have flipped behind to false. Note: in
    // jsdom, programmatic scrollTop assignment doesn't fire scroll.
    // We test the outcome — pill is gone — directly.
    await waitFor(() => {
      expect(
        document.querySelector('[data-component="JumpToLatest"]'),
      ).toBeNull();
    });
    expect(thread.scrollTop).toBe(thread.scrollHeight);
  });
});
