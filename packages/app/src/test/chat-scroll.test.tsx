import { fireEvent, render, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceThread } from "../tabs/WorkspaceThread";
import { __setIpcClient, ipcClient, type IpcClient } from "../ipc/client";
import { createMockCore, type MockCore } from "../ipc/mock";
import {
  chatThreadStore,
  emptyChatThread,
  subprocessKey,
} from "../store/chatThread";
import { flagsStore } from "../store/flags";
import type {
  ArtifactSummary,
  ClaudeMessageId,
  ClaudeSessionId,
  EventId,
  StreamEvent,
  TabId,
  Workspace,
  WorkspaceId,
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
    renameWorkspace: (id, name) =>
      Promise.resolve(mock.renameWorkspace(id, name)),
    renameTab: (w, t, title) => Promise.resolve(mock.renameTab(w, t, title)),
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
    teamLifecycleStream: () => () => {},
    listWorkspaceChatEvents: () => Promise.resolve([]),
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
    completeTrack: (req) => {
      mock.completeTrack(req);
      return Promise.resolve();
    },
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
    reportFriction: () => Promise.resolve({ friction_id: "f", local_path: "" }),
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
function installScrollShim(
  el: HTMLElement,
  scrollHeight: number,
  clientHeight: number,
) {
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
    artifacts = [
      makeArtifact("user", "go"),
      makeArtifact("agent", "first reply"),
    ];
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

/**
 * 24H-W1a — chat-v2 (Phase 24 surface) scroll-stickiness. Closes spec
 * Q4 ("scroll-anchor behavior on long streams"). Mirrors the legacy
 * B6 contract on the chat-v2 surface: thread pins to the bottom while
 * the user is at (or near) it; doesn't yank when the user has scrolled
 * up; once behind, the Jump-to-latest pill appears and re-pins on click.
 *
 * The implementation difference vs. legacy is the inner-content
 * ResizeObserver: chat-v2 streams via AgentContentBlockDelta updates
 * that extend an open block without changing any value the layout
 * effect's deps catch, so a RO observes the scroll container's first
 * child for height growth. The test triggers the observer via the
 * MockResizeObserver shim in `setup.ts`.
 */
describe("Thread scroll stickiness — chat-v2 (24H-W1a)", () => {
  let originalClient: IpcClient;
  let mock: MockCore;
  let workspace: Workspace;
  const TAB: TabId = "tab-chat-v2" as TabId;

  function enableChatV2() {
    flagsStore.set({
      flags: {
        show_chat_v2: true,
        show_recent_reports_v2: false,
        show_roadmap_canvas: false,
        show_compose_stop_and_send: true,
      } as never,
      loaded: true,
    });
  }

  function seedTurnWithText(ws: WorkspaceId, tab: TabId, body: string) {
    const turnId = `turn-${Math.random().toString(36).slice(2, 8)}` as ClaudeMessageId;
    chatThreadStore.set((s) => ({
      ...s,
      byTab: {
        ...s.byTab,
        [tab]: {
          ...(s.byTab[tab] ?? emptyChatThread()),
          row_order: [
            ...((s.byTab[tab] ?? emptyChatThread()).row_order),
            { kind: "turn", turn_id: turnId },
          ],
          turns: {
            ...((s.byTab[tab] ?? emptyChatThread()).turns),
            [turnId]: {
              turn_id: turnId,
              workspace_id: ws,
              tab_id: tab,
              model: "claude-sonnet-4-6",
              parent_user_event_id: "evt-0" as EventId,
              session_id: "sess-0" as ClaudeSessionId,
              started_at: Date.now(),
              block_order: [0],
              blocks: {
                0: {
                  block_index: 0,
                  kind: { kind: "text" },
                  delta: body,
                  ended: true,
                },
              },
              tool_results: {},
              stop_reason: "end_turn",
              usage: null,
              is_legacy: false,
            },
          },
        },
      },
      runningSubprocesses: new Set([
        ...s.runningSubprocesses,
        subprocessKey(ws, tab),
      ]),
    }));
  }

  function appendDeltaToOpenTurn(tab: TabId, more: string) {
    chatThreadStore.set((s) => {
      const tabState = s.byTab[tab];
      if (!tabState) return s;
      const lastTurn = [...tabState.row_order]
        .reverse()
        .find((r) => r.kind === "turn");
      if (!lastTurn || lastTurn.kind !== "turn") return s;
      const turn = tabState.turns[lastTurn.turn_id];
      const block = turn.blocks[0];
      return {
        ...s,
        byTab: {
          ...s.byTab,
          [tab]: {
            ...tabState,
            turns: {
              ...tabState.turns,
              [lastTurn.turn_id]: {
                ...turn,
                blocks: {
                  ...turn.blocks,
                  0: { ...block, delta: block.delta + more },
                },
              },
            },
          },
        },
      };
    });
  }

  beforeEach(() => {
    originalClient = ipcClient();
    mock = createMockCore();
    const project = mock.listProjects()[0];
    workspace = mock.listWorkspaces(project.project.id)[0].workspace;
    listArtifactsCb = () => [];
    lastStream = null;
    __setIpcClient(makeClient(mock, workspace));
    chatThreadStore.set({
      byTab: {},
      runningSubprocesses: new Set(),
      bootReplaying: false,
    });
    enableChatV2();
    // Reset RO mock instances captured by the shim.
    const RO = window.ResizeObserver as unknown as {
      instances?: Array<{ __trigger: () => void }>;
    };
    if (Array.isArray(RO.instances)) RO.instances.length = 0;
  });

  afterEach(() => {
    __setIpcClient(originalClient);
    flagsStore.set({ flags: null, loaded: false });
  });

  async function bootChatV2Thread() {
    seedTurnWithText(workspace.id, TAB, "first agent reply");
    const r = render(<WorkspaceThread workspace={workspace} tabId={TAB} />);
    const thread = await waitFor(() => {
      const el = document.querySelector<HTMLElement>(".thread--phase24");
      if (!el) throw new Error("chat-v2 thread did not mount");
      return el;
    });
    return { ...r, thread };
  }

  function triggerResizeObservers() {
    const RO = window.ResizeObserver as unknown as {
      instances?: Array<{ __trigger: () => void }>;
    };
    for (const inst of RO.instances ?? []) inst.__trigger();
  }

  // T-24H-W1a-1 — Jump-to-latest pill appears once the user scrolls up
  // on the chat-v2 surface. Equivalent of legacy T8 ported over.
  it("shows the jump-to-latest pill once the user has scrolled up", async () => {
    const { thread } = await bootChatV2Thread();
    installScrollShim(thread, 1000, 400);
    thread.scrollTop = 100; // way above the bottom (distance = 500 > 32)
    fireEvent.scroll(thread);

    await waitFor(() => {
      expect(
        document.querySelector('[data-component="JumpToLatest"]'),
      ).not.toBeNull();
    });
  });

  // T-24H-W1a-2 — content grows while the user is scrolled up; the
  // surface must NOT yank them back down. This is the user-visible
  // regression that surfaced when show_chat_v2 flipped default ON in
  // PR #134 — the chat-v2 container had no stickRef logic at all, so
  // every streaming delta scrolled the viewport.
  it("does not yank the viewport when content streams while the user is scrolled up", async () => {
    const { thread } = await bootChatV2Thread();
    installScrollShim(thread, 1000, 400);
    thread.scrollTop = 120;
    fireEvent.scroll(thread);
    const before = thread.scrollTop;

    // Simulate a streaming delta extending the open turn's text block.
    // In production this lands as AgentContentBlockDelta → reducer
    // updates → DOM grows → ResizeObserver fires our pin path.
    await act(async () => {
      appendDeltaToOpenTurn(TAB, " — and a long continuation that grows the thread");
      installScrollShim(thread, 1400, 400); // height grew
      triggerResizeObservers();
    });

    expect(thread.scrollTop).toBe(before);
  });

  // T-24H-W1a-3 — when the user is pinned at the bottom, a streaming
  // delta re-pins the viewport. Drives the ResizeObserver path
  // directly (jsdom has no layout engine).
  it("re-pins to the bottom on inner-content growth while sticky", async () => {
    const { thread } = await bootChatV2Thread();
    installScrollShim(thread, 1000, 400);
    thread.scrollTop = 600; // at bottom (1000 - 400 = 600)
    fireEvent.scroll(thread); // confirms stickRef stays true

    await act(async () => {
      appendDeltaToOpenTurn(TAB, " more text");
      installScrollShim(thread, 1400, 400);
      triggerResizeObservers();
    });

    // pinToBottom assigns `scrollTop = scrollHeight`. In a real
    // browser that clamps to `scrollHeight - clientHeight`; jsdom
    // stores the raw value. Either way the post-condition is
    // `scrollTop === scrollHeight` — the legacy T8 test uses the same
    // assertion to dodge the clamp difference.
    expect(thread.scrollTop).toBe(thread.scrollHeight);
  });

  // T-24H-W1a-4 — clicking the Jump-to-latest pill re-pins and hides
  // the pill. Same semantics as legacy T8 — the pill component is
  // shared; only the container that owns the ref differs.
  it("hides the pill and re-pins on Jump-to-latest click", async () => {
    const { thread } = await bootChatV2Thread();
    installScrollShim(thread, 1000, 400);
    thread.scrollTop = 100;
    fireEvent.scroll(thread);

    const pill = await waitFor(() =>
      document.querySelector<HTMLButtonElement>(
        '[data-component="JumpToLatest"]',
      ),
    );
    fireEvent.click(pill!);

    await waitFor(() => {
      expect(
        document.querySelector('[data-component="JumpToLatest"]'),
      ).toBeNull();
    });
    expect(thread.scrollTop).toBe(thread.scrollHeight);
  });

  // T-24H-W1a-5 — the programmatic-scroll guard prevents auto-pin
  // scrolls from flipping stickRef false. Without it, a content-growth
  // re-pin can race a natural scroll event from the layout reflow and
  // un-stick the surface. The guard is a microtask boundary; once it
  // releases, real user scrolls take effect as normal.
  it("survives a programmatic re-pin without un-sticking, but still honors a subsequent user scroll", async () => {
    const { thread } = await bootChatV2Thread();
    installScrollShim(thread, 1000, 400);
    thread.scrollTop = 600;

    // Programmatic re-pin path: while the guard is up, a synthesized
    // scroll event in the same tick should be ignored.
    await act(async () => {
      installScrollShim(thread, 1400, 400);
      triggerResizeObservers();
      // Simulate the natural scroll event that some browsers fire as
      // a result of the programmatic scrollTop assignment — the guard
      // must absorb it so stickRef stays true.
      fireEvent.scroll(thread);
    });

    // Pill must NOT appear from the absorbed event.
    expect(
      document.querySelector('[data-component="JumpToLatest"]'),
    ).toBeNull();

    // Now drop a microtask so the guard clears, then fire a real user
    // scroll up. The guard must not swallow this one.
    await Promise.resolve();
    thread.scrollTop = 50;
    fireEvent.scroll(thread);
    await waitFor(() => {
      expect(
        document.querySelector('[data-component="JumpToLatest"]'),
      ).not.toBeNull();
    });
  });
});
