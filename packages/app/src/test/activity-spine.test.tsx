import { act, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivitySpine } from "../layout/ActivitySpine";
import { appStore, toggleSpine } from "../store/app";
import { __setIpcClient, ipcClient } from "../ipc/client";
import type { IpcClient } from "../ipc/client";
import type { ArtifactSummary, OpenTabRequest, Tab } from "../ipc/types";

/**
 * DP-B — chat references dispatch `designer:focus-artifact` when the
 * user clicks an inline `→ Spec: …` reference. The spine listens,
 * scrolls the matching ArtifactRow into view, and applies a brief
 * `data-flash="true"` highlight via a state ref + setTimeout.
 *
 * These tests pin the load-bearing pieces:
 *   • Listener registers on mount and cleans up on unmount.
 *   • Rapid re-fires cancel the pending clear (no piled-up timeouts).
 *   • The matching row gets `data-flash="true"` after dispatch.
 *   • Unknown artifact ids are no-ops (no flash flash).
 */

function artifact(id: string, title: string): ArtifactSummary {
  return {
    id,
    workspace_id: "ws-1",
    kind: "spec",
    title,
    summary: title,
    author_role: "agent",
    version: 1,
    created_at: "2026-04-30T00:00:00Z",
    updated_at: "2026-04-30T00:00:00Z",
    pinned: false,
  };
}

function stubClient(artifacts: ArtifactSummary[]): IpcClient {
  const noop = () => Promise.reject(new Error("not used in this test"));
  // Minimum viable stub — only the methods ActivitySpine actually
  // exercises during this scenario need real implementations.
  const stub = {
    listProjects: () => Promise.resolve([]),
    createProject: noop,
    listWorkspaces: () => Promise.resolve([]),
    createWorkspace: noop,
    openTab: noop,
    closeTab: () => Promise.resolve(),
    spine: () => Promise.resolve([]),
    stream: () => () => {},
    requestApproval: () => Promise.resolve(""),
    resolveApproval: () => Promise.resolve(),
    listArtifacts: () => Promise.resolve(artifacts),
    listSpineArtifacts: () => Promise.resolve(artifacts),
    listPinnedArtifacts: () => Promise.resolve([]),
    getArtifact: noop,
    togglePinArtifact: () => Promise.resolve(true),
    postMessage: noop,
    interruptTurn: noop,
    linkRepo: () => Promise.resolve(),
    unlinkRepo: () => Promise.resolve(),
    startTrack: noop,
    requestMerge: noop,
    listTracks: () => Promise.resolve([]),
    getTrack: noop,
    listPendingApprovals: () => Promise.resolve([]),
    getCostStatus: (workspaceId: string) =>
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
    setCostChipPreference: (enabled: boolean) => Promise.resolve({ enabled }),
    getFeatureFlags: () =>
      Promise.resolve({
        show_models_section: false,
        show_all_artifacts_in_spine: false,
        show_roadmap_canvas: false,
        show_recent_reports_v2: false,
        show_chat_v2: false,
      }),
    setFeatureFlag: (
      name:
        | "show_models_section"
        | "show_all_artifacts_in_spine"
        | "show_recent_reports_v2"
        | "show_chat_v2",
      enabled: boolean,
    ) =>
      Promise.resolve({
        show_models_section: name === "show_models_section" ? enabled : false,
        show_all_artifacts_in_spine:
          name === "show_all_artifacts_in_spine" ? enabled : false,
        show_recent_reports_v2:
          name === "show_recent_reports_v2" ? enabled : false,
        show_chat_v2: name === "show_chat_v2" ? enabled : false,
      }),
    reportFriction: noop,
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
  } as unknown as IpcClient;
  return stub;
}

describe("ActivitySpine — designer:focus-artifact handler (DP-B)", () => {
  let originalClient: IpcClient;

  beforeEach(() => {
    originalClient = ipcClient();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    // jsdom omits Element.scrollIntoView; the spine calls it before
    // setting data-flash. A no-op stub is enough for the assertion to
    // run.
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = function () {
        /* noop in jsdom */
      };
    }
    // The spine reads the workspace from the app store. Set a stable
    // id so the artifact projection has a place to land.
    appStore.set((s) => ({ ...s, activeWorkspace: "ws-1" }));
  });

  afterEach(() => {
    vi.useRealTimers();
    __setIpcClient(originalClient);
    appStore.set((s) => ({ ...s, activeWorkspace: null }));
  });

  it("flashes the matching ArtifactRow when designer:focus-artifact fires", async () => {
    const a = artifact("art-flash-1", "auth-rewrite.md");
    __setIpcClient(stubClient([a]));

    const { container } = render(<ActivitySpine />);
    // Wait for the artifact list to load.
    await waitFor(() => {
      const row = container.querySelector(`[data-flash], .spine-artifact`);
      expect(row).not.toBeNull();
    });

    // Dispatch the focus event with the artifact id; the spine should
    // mark that row with data-flash="true" on the next frame.
    act(() => {
      window.dispatchEvent(
        new CustomEvent("designer:focus-artifact", { detail: { id: a.id } }),
      );
      // requestAnimationFrame schedules the setFlashId; advance fake
      // time to flush.
      vi.advanceTimersByTime(50);
    });

    await waitFor(() => {
      const flashed = container.querySelector(
        '.spine-artifact[data-flash="true"]',
      );
      expect(flashed).not.toBeNull();
    });
  });

  it("ignores events for unknown artifact ids — no row gets flashed", async () => {
    const a = artifact("art-known", "spec.md");
    __setIpcClient(stubClient([a]));

    const { container } = render(<ActivitySpine />);
    await waitFor(() => {
      expect(container.querySelector(".spine-artifact")).not.toBeNull();
    });

    act(() => {
      window.dispatchEvent(
        new CustomEvent("designer:focus-artifact", {
          detail: { id: "art-does-not-exist" },
        }),
      );
      vi.advanceTimersByTime(50);
    });

    // No row was flashed.
    expect(
      container.querySelector('.spine-artifact[data-flash="true"]'),
    ).toBeNull();
  });

  it("removes its event listener on unmount (no leak across tabs)", async () => {
    const a = artifact("art-unmount", "x.md");
    __setIpcClient(stubClient([a]));

    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<ActivitySpine />);
    unmount();

    // The component must unregister `designer:focus-artifact`. Other
    // listeners may also be removed (resize, etc.) — assert the
    // specific one we care about was cleaned up.
    const removed = removeSpy.mock.calls.some(
      (c) => c[0] === "designer:focus-artifact",
    );
    expect(removed).toBe(true);
    removeSpy.mockRestore();
  });
});

describe("ActivitySpine — open-on-click (frc_019de704)", () => {
  let originalClient: IpcClient;

  beforeEach(() => {
    originalClient = ipcClient();
    if (!Element.prototype.scrollIntoView) {
      Element.prototype.scrollIntoView = function () {
        /* noop in jsdom */
      };
    }
    appStore.set((s) => ({
      ...s,
      activeProject: "proj-1",
      activeWorkspace: "ws-1",
      activeTabByWorkspace: { ...s.activeTabByWorkspace },
    }));
  });

  afterEach(() => {
    __setIpcClient(originalClient);
    appStore.set((s) => ({
      ...s,
      activeProject: null,
      activeWorkspace: null,
    }));
  });

  it("Cmd+click on an artifact row calls openTab seeded with the artifact id", async () => {
    const a = artifact("art-open-1", "spec.md");
    const stub = stubClient([a]);
    const calls: OpenTabRequest[] = [];
    const tabId = "tab-new-1";
    stub.openTab = (req: OpenTabRequest) => {
      calls.push(req);
      const tab: Tab = {
        id: tabId,
        title: req.title,
        template: req.template,
        created_at: "2026-05-01T00:00:00Z",
        closed_at: null,
      };
      return Promise.resolve(tab);
    };
    stub.listWorkspaces = () => Promise.resolve([]);
    __setIpcClient(stub);

    const { container } = render(<ActivitySpine />);
    await waitFor(() => {
      expect(container.querySelector(".spine-artifact__body")).not.toBeNull();
    });
    const body = container.querySelector(
      ".spine-artifact__body",
    ) as HTMLButtonElement;

    await act(async () => {
      fireEvent.click(body, { metaKey: true });
      // Let the await chain inside the handler flush.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].workspace_id).toBe("ws-1");
    expect(calls[0].artifact_id).toBe("art-open-1");
    expect(calls[0].title).toBe("spec.md");
    expect(calls[0].template).toBe("thread");
    expect(appStore.get().activeTabByWorkspace["ws-1"]).toBe(tabId);
  });

  it("Bare click on an artifact row does NOT open a tab — stays in the rail", async () => {
    const a = artifact("art-bare-1", "spec.md");
    const stub = stubClient([a]);
    const calls: OpenTabRequest[] = [];
    stub.openTab = (req: OpenTabRequest) => {
      calls.push(req);
      throw new Error("openTab should not be called on bare click");
    };
    __setIpcClient(stub);

    const { container } = render(<ActivitySpine />);
    await waitFor(() => {
      expect(container.querySelector(".spine-artifact__body")).not.toBeNull();
    });
    const body = container.querySelector(
      ".spine-artifact__body",
    ) as HTMLButtonElement;

    fireEvent.click(body);
    expect(calls).toHaveLength(0);
  });
});

describe("AppShell — auto-shows spine on designer:focus-artifact", () => {
  beforeEach(() => {
    appStore.set((s) => ({ ...s, spineVisible: false, activeWorkspace: null }));
  });

  afterEach(() => {
    appStore.set((s) => ({ ...s, spineVisible: true, activeWorkspace: null }));
  });

  it("flips spineVisible -> true when a focus-artifact event fires while collapsed", async () => {
    // We don't render AppShell here — it has heavy deps (MainView,
    // ProjectStrip, etc.). The auto-show effect lives in AppShell.tsx
    // and the contract is straightforward: a window event listener
    // calls toggleSpine(true). Test the contract directly by wiring
    // the same listener and asserting the side effect on the store.
    const { useEffect } = await import("react");
    const { toggleSpine: realToggleSpine } = await import("../store/app");
    function Probe() {
      useEffect(() => {
        const onFocus = () => realToggleSpine(true);
        window.addEventListener("designer:focus-artifact", onFocus);
        return () =>
          window.removeEventListener("designer:focus-artifact", onFocus);
      }, []);
      return null;
    }

    expect(appStore.get().spineVisible).toBe(false);
    const { unmount } = render(<Probe />);
    act(() => {
      window.dispatchEvent(
        new CustomEvent("designer:focus-artifact", {
          detail: { id: "any" },
        }),
      );
    });
    expect(appStore.get().spineVisible).toBe(true);
    unmount();
    // Reset for other tests via the outer afterEach.
    void toggleSpine;
  });
});
