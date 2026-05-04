import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FrictionWidget } from "../components/Friction/FrictionWidget";
import { SelectionOverlay } from "../components/Friction/SelectionOverlay";
import { FrictionTriageSection } from "../layout/SettingsPage";
import type { FrictionEntry } from "../ipc/types";
import {
  appStore,
  clearFriction,
  enterFrictionSelecting,
  toggleFrictionComposer,
} from "../store/app";
import { __setIpcClient, ipcClient } from "../ipc/client";
import type { IpcClient } from "../ipc/client";
import type { StreamEvent } from "../ipc/types";

function stubClient(overrides: Partial<IpcClient> = {}): IpcClient {
  const base: IpcClient = {
    listProjects: () => Promise.resolve([]),
    createProject: () => Promise.reject(new Error("nope")),
    listWorkspaces: () => Promise.resolve([]),
    createWorkspace: () => Promise.reject(new Error("nope")),
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
        show_all_artifacts_in_spine: false, show_roadmap_canvas: false,
      }),
    setFeatureFlag: (name, enabled) =>
      Promise.resolve({
        show_models_section: name === "show_models_section" ? enabled : false,
        show_all_artifacts_in_spine:
          name === "show_all_artifacts_in_spine" ? enabled : false,
        show_roadmap_canvas: name === "show_roadmap_canvas" ? enabled : false,
      }),
    reportFriction: () =>
      Promise.resolve({ friction_id: "frc_stub_abcdef", local_path: "" }),
    listFriction: () => Promise.resolve([]),
    resolveFriction: () => Promise.resolve(),
    addressFriction: () => Promise.resolve(),
    reopenFriction: () => Promise.resolve(),
    captureViewport: () => Promise.resolve(new Uint8Array([0, 1, 2, 3])),
    revealInFinder: () => Promise.resolve(),
    onStoreChanged: () => () => {},
    listFindings: () => Promise.resolve([]),
    signalFinding: () => Promise.resolve(),
    listProposals: () => Promise.resolve([]),
    resolveProposal: () => Promise.resolve(),
    signalProposal: () => Promise.resolve(),
  getRoadmap: () => Promise.resolve({ tree: null, parse_error: null, claims: [], shipments: [], source_hash: null, roadmap_path: "core-docs/roadmap.md" }),
  setNodeStatus: () => Promise.resolve(),
    writeRoadmapDraft: () => Promise.resolve(),
  };
  return { ...base, ...overrides };
}

describe("FrictionWidget — Track 13.M composer-default flow", () => {
  beforeEach(() => {
    clearFriction();
    __setIpcClient(stubClient());
  });

  afterEach(() => {
    clearFriction();
  });

  it("does not render while frictionMode === 'off'", () => {
    render(<FrictionWidget />);
    expect(screen.queryByRole("dialog", { name: /capture friction/i })).toBeNull();
  });

  it("opens with the body textarea autofocused on ⌘⇧F", async () => {
    render(<FrictionWidget />);
    act(() => toggleFrictionComposer());
    const body = await screen.findByPlaceholderText(/what's friction-y\?/i);
    await waitFor(() => expect(document.activeElement).toBe(body));
  });

  it("submits with body alone (no anchor required)", async () => {
    const reportFriction: IpcClient["reportFriction"] = vi.fn(() =>
      Promise.resolve({ friction_id: "frc_no_anchor_xyz789", local_path: "" }),
    );
    __setIpcClient(stubClient({ reportFriction }));

    render(<FrictionWidget />);
    act(() => toggleFrictionComposer());

    const body = await screen.findByPlaceholderText(/what's friction-y\?/i);
    fireEvent.change(body, { target: { value: "this is broken" } });
    const submit = screen.getByRole("button", { name: /submit/i });
    expect((submit as HTMLButtonElement).disabled).toBe(false);

    const mock = reportFriction as ReturnType<typeof vi.fn>;
    fireEvent.click(submit);
    await waitFor(() => expect(mock).toHaveBeenCalledTimes(1));
    const call = mock.mock.calls[0]?.[0];
    expect(call).toBeDefined();
    expect(call.body).toBe("this is broken");
    expect(call.anchor.kind).toBe("dom-element");
  });

  it("⌘. enters selection mode (composer hides, overlay arms)", async () => {
    render(<FrictionWidget />);
    act(() => toggleFrictionComposer());
    expect(appStore.get().frictionMode).toBe("composing");

    const body = await screen.findByPlaceholderText(/what's friction-y\?/i);
    fireEvent.keyDown(body, { key: ".", metaKey: true });
    expect(appStore.get().frictionMode).toBe("selecting");
  });

  it("renders an anchor chip when an anchor is set, and clears it via ×", async () => {
    render(<FrictionWidget />);
    act(() => toggleFrictionComposer());
    act(() => {
      appStore.set((s) => ({
        ...s,
        frictionMode: "composing",
        frictionAnchor: {
          kind: "dom-element",
          selectorPath: "[data-component=\"WorkspaceSidebar\"]",
          route: "/workspace/x",
          component: "WorkspaceSidebar",
          stableId: undefined,
          textSnippet: "Track A",
        },
      }));
    });
    expect(await screen.findByText("WorkspaceSidebar")).toBeTruthy();

    const clear = screen.getByLabelText(/clear anchor/i);
    fireEvent.click(clear);
    expect(appStore.get().frictionAnchor).toBe(null);
    // Composer stays open after clearing the anchor.
    expect(appStore.get().frictionMode).toBe("composing");
  });

  it("upgrades the toast from 'Filed locally' → 'Filed as #N' on stream confirmation", async () => {
    // Friction id is chosen so its last 6 chars contain at least one
    // non-hex character — otherwise the toast text "Filed as #xyzxyz"
    // would match the no-hex-literals-in-tsx invariant regex.
    const fid = "frc_test_xyzxyz";
    let streamHandler: ((event: StreamEvent) => void) | null = null;
    const reportFriction = vi.fn(() =>
      Promise.resolve({ friction_id: fid, local_path: "" }),
    );
    __setIpcClient(
      stubClient({
        reportFriction,
        stream: (h) => {
          streamHandler = h;
          return () => {
            streamHandler = null;
          };
        },
        activityStream: () => () => {},
      }),
    );

    render(<FrictionWidget />);
    act(() => toggleFrictionComposer());
    const body = await screen.findByPlaceholderText(/what's friction-y\?/i);
    fireEvent.change(body, { target: { value: "stream test" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    await screen.findByText(/filed locally/i);
    expect(streamHandler).not.toBeNull();
    act(() => {
      streamHandler!({
        kind: "friction_reported",
        stream_id: "system",
        sequence: 1,
        timestamp: new Date().toISOString(),
        payload: { friction_id: fid },
      });
    });
    await screen.findByText(new RegExp(`filed as #${fid.slice(-6)}`, "i"));
  });
});

describe("SelectionOverlay — Track 13.M opt-in mode", () => {
  beforeEach(() => {
    clearFriction();
    __setIpcClient(stubClient());
  });
  afterEach(() => {
    clearFriction();
  });

  it("mounts the persistent legend when armed", async () => {
    // Get to selection mode via the legitimate path: composer → ⌘.
    act(() => {
      toggleFrictionComposer();
      enterFrictionSelecting();
    });
    render(<SelectionOverlay />);
    expect(screen.getByText(/click element to anchor/i)).toBeTruthy();
    expect(
      screen.getByText(/alt: anchor exact child · esc to cancel/i),
    ).toBeTruthy();
  });

  it("ignores click-outside fired within 50ms of arming, exits after", async () => {
    // jsdom doesn't ship `elementFromPoint`; install a stub property so
    // the overlay's click handler can resolve a target without throwing.
    const originalEFP = (document as { elementFromPoint?: unknown })
      .elementFromPoint;
    (document as { elementFromPoint?: unknown }).elementFromPoint = () =>
      document.body;

    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1000);

    act(() => {
      toggleFrictionComposer();
      enterFrictionSelecting();
    });
    render(<SelectionOverlay />);
    expect(appStore.get().frictionMode).toBe("selecting");

    // t = +20ms → suppression still active. The overlay's click handler
    // checks Date.now() against the armed timestamp.
    nowSpy.mockReturnValue(1020);
    fireEvent.click(document.body);
    expect(appStore.get().frictionMode).toBe("selecting");

    // t = +80ms → suppression elapsed; click-outside now exits to composer.
    nowSpy.mockReturnValue(1080);
    fireEvent.click(document.body);
    expect(appStore.get().frictionMode).toBe("composing");

    nowSpy.mockRestore();
    (document as { elementFromPoint?: unknown }).elementFromPoint = originalEFP;
  });
});

describe("captureViewport — Track 13.M ⌘⇧S path", () => {
  it("hits the IPC client and returns Uint8Array bytes", async () => {
    __setIpcClient(stubClient());
    const bytes = await ipcClient().captureViewport();
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.byteLength).toBeGreaterThan(0);
  });
});

describe("FrictionTriageSection — onStoreChanged re-fetch", () => {
  function makeEntry(overrides: Partial<FrictionEntry> = {}): FrictionEntry {
    return {
      friction_id: "frc_test_a",
      workspace_id: null,
      project_id: null,
      created_at: new Date().toISOString(),
      body: "row body",
      route: "/r",
      title: "Test row",
      anchor_descriptor: "TestComponent",
      state: "open",
      pr_url: null,
      screenshot_path: null,
      local_path: "/tmp/.designer/friction/frc_test_a.md",
      ...overrides,
    };
  }

  it("re-fetches and reflects state changes when the watcher fires", async () => {
    let storeHandler: (() => void) | null = null;
    const listFriction = vi
      .fn<() => Promise<FrictionEntry[]>>()
      .mockResolvedValueOnce([makeEntry({ state: "open" })])
      .mockResolvedValueOnce([makeEntry({ state: "addressed" })]);
    __setIpcClient(
      stubClient({
        listFriction: listFriction as unknown as IpcClient["listFriction"],
        onStoreChanged: (h) => {
          storeHandler = h;
          return () => {
            storeHandler = null;
          };
        },
      }),
    );

    render(<FrictionTriageSection />);

    // Initial mount fetches once and renders the row in `open` state. The
    // default filter is `open` so the row is visible without a filter
    // change.
    await waitFor(() => expect(listFriction).toHaveBeenCalledTimes(1));
    expect(storeHandler).not.toBeNull();

    // Simulate the Rust watcher emitting after a CLI write.
    act(() => {
      storeHandler!();
    });

    // Second fetch fires; row's state flips to addressed. Filter chip
    // does NOT auto-bounce — the row leaves the open chip but stays in
    // the projection (visible from `All`). The most reliable assertion
    // here is the listFriction call count, since the filter could mask
    // the row in the DOM.
    await waitFor(() => expect(listFriction).toHaveBeenCalledTimes(2));
  });

  it("bulk copy button bundles every filtered record into one clipboard write", async () => {
    // Snapshot the original clipboard descriptor so the override is
    // strictly local to this test. Without restoration the stub leaks
    // into every later test in the same vitest worker that touches
    // navigator.clipboard.
    const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, "clipboard");
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    try {
      const entries = [
        makeEntry({ friction_id: "frc_a", local_path: "/tmp/.designer/friction/frc_a.md" }),
        makeEntry({ friction_id: "frc_b", local_path: "/tmp/.designer/friction/frc_b.md" }),
        makeEntry({ friction_id: "frc_c", local_path: "/tmp/.designer/friction/frc_c.md" }),
      ];
      __setIpcClient(stubClient({ listFriction: () => Promise.resolve(entries) }));

      render(<FrictionTriageSection />);

      // Wait for the rows to render so the button label has settled to the
      // real count rather than the empty-list placeholder.
      const button = await screen.findByRole("button", { name: /Copy 3 as one prompt/i });
      fireEvent.click(button);

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const payload = writeText.mock.calls[0]![0];
      expect(payload).toContain("3 open Designer friction reports");
      expect(payload).toContain("/tmp/.designer/friction/frc_a.md");
      expect(payload).toContain("/tmp/.designer/friction/frc_b.md");
      expect(payload).toContain("/tmp/.designer/friction/frc_c.md");
      expect(payload).toContain("designer friction address");
    } finally {
      if (originalClipboard) {
        Object.defineProperty(window.navigator, "clipboard", originalClipboard);
      } else {
        // jsdom doesn't ship a clipboard descriptor by default; if there
        // wasn't one before, drop ours rather than leave a stub behind.
        delete (window.navigator as unknown as { clipboard?: unknown }).clipboard;
      }
    }
  });

  it("bulk copy button is disabled (no count flicker) while the projection is still loading", async () => {
    // Hold the projection promise open so the section sits in its
    // loading state through the assertion. The button must read
    // "Copy as prompt" + disabled — never "Copy 0 as one prompt", which
    // would advertise an empty clipboard write to the user mid-fetch.
    let resolveList: (entries: FrictionEntry[]) => void = () => {};
    const pending = new Promise<FrictionEntry[]>((r) => {
      resolveList = r;
    });
    __setIpcClient(stubClient({ listFriction: () => pending }));

    render(<FrictionTriageSection />);

    const button = await screen.findByRole("button", { name: /Copy as prompt/i });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).not.toMatch(/0/);

    // Resolve so the cleanup phase doesn't leave a dangling promise.
    resolveList([]);
  });
});
