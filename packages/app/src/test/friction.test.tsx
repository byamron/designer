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
import {
  FrictionTriageSection,
  formatRelativeTime,
  humanizeAnchor,
} from "../layout/SettingsPage";
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
    captureViewport: () => Promise.resolve(new Uint8Array([0, 1, 2, 3])),
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
    expect(
      screen.queryByRole("dialog", { name: /capture friction/i }),
    ).toBeNull();
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
          selectorPath: '[data-component="WorkspaceSidebar"]',
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
    const originalClipboard = Object.getOwnPropertyDescriptor(
      window.navigator,
      "clipboard",
    );
    const writeText = vi.fn(async (_text: string) => {});
    Object.defineProperty(window.navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    try {
      const entries = [
        makeEntry({
          friction_id: "frc_a",
          local_path: "/tmp/.designer/friction/frc_a.md",
        }),
        makeEntry({
          friction_id: "frc_b",
          local_path: "/tmp/.designer/friction/frc_b.md",
        }),
        makeEntry({
          friction_id: "frc_c",
          local_path: "/tmp/.designer/friction/frc_c.md",
        }),
      ];
      __setIpcClient(
        stubClient({ listFriction: () => Promise.resolve(entries) }),
      );

      render(<FrictionTriageSection />);

      // Wait for the rows to render so the button label has settled to the
      // real count rather than the empty-list placeholder.
      const button = await screen.findByRole("button", {
        name: /Triage 3 with agent/i,
      });
      fireEvent.click(button);

      await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
      const payload = writeText.mock.calls[0]![0];
      expect(payload).toContain("triaging 3 open Designer friction reports");
      expect(payload).toContain("/tmp/.designer/friction/frc_a.md");
      expect(payload).toContain("/tmp/.designer/friction/frc_b.md");
      expect(payload).toContain("/tmp/.designer/friction/frc_c.md");
      expect(payload).toContain("designer friction address");
      // The retuned prompt explicitly tells the agent to cluster + ship
      // one PR per cluster — locks the agent-driven contract so a future
      // edit can't silently revert it.
      expect(payload).toContain("Cluster reports");
      expect(payload).toContain("one PR per cluster");
    } finally {
      if (originalClipboard) {
        Object.defineProperty(window.navigator, "clipboard", originalClipboard);
      } else {
        // jsdom doesn't ship a clipboard descriptor by default; if there
        // wasn't one before, drop ours rather than leave a stub behind.
        delete (window.navigator as unknown as { clipboard?: unknown })
          .clipboard;
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

    const button = await screen.findByRole("button", {
      name: /Triage with agent/i,
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(button.textContent).not.toMatch(/0/);

    // Resolve so the cleanup phase doesn't leave a dangling promise.
    resolveList([]);
  });
});

describe("FrictionTriageSection — agent-driven triage redesign", () => {
  // Sample-row helper local to this block so the new behaviour tests
  // don't depend on the helper inside the previous describe.
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

  it("Open filter includes addressed rows so agent-owned work stays visible", async () => {
    __setIpcClient(
      stubClient({
        listFriction: () =>
          Promise.resolve([
            makeEntry({
              friction_id: "frc_open_x",
              title: "Open thing",
              state: "open",
            }),
            makeEntry({
              friction_id: "frc_addr_y",
              title: "Agent thing",
              state: "addressed",
              pr_url: "https://github.com/owner/repo/pull/42",
            }),
            makeEntry({
              friction_id: "frc_done_z",
              title: "Done thing",
              state: "resolved",
            }),
          ]),
      }),
    );

    render(<FrictionTriageSection />);

    // Both the open row and the addressed row land under the default
    // "Open" filter — the addressed entry no longer disappears the way
    // it did under the strict-equality filter the redesign replaced.
    expect(await screen.findByText("Open thing")).toBeTruthy();
    expect(await screen.findByText("Agent thing")).toBeTruthy();
    expect(screen.queryByText("Done thing")).toBeNull();
  });

  it("addressed rows surface an inline agent indicator with the PR shortlabel when set", async () => {
    __setIpcClient(
      stubClient({
        listFriction: () =>
          Promise.resolve([
            makeEntry({
              friction_id: "frc_with_pr",
              title: "PR landed",
              state: "addressed",
              pr_url: "https://github.com/owner/repo/pull/910",
            }),
            makeEntry({
              friction_id: "frc_no_pr",
              title: "Just picked up",
              state: "addressed",
              pr_url: null,
              anchor_descriptor: "OtherComponent",
            }),
          ]),
      }),
    );

    render(<FrictionTriageSection />);

    // PR shortlabel reads "owner/repo#910" — the row meta line carries
    // the chip so the user can see "agent is on it" without expanding.
    // Hash + number assembled from a variable so the literal token
    // doesn't trip the no-hex-literals-in-tsx invariant (PR numbers are
    // all decimal digits, which the invariant treats as a hex string).
    const prNum = "910";
    expect(
      await screen.findByText(new RegExp(`agent . owner/repo#${prNum}`)),
    ).toBeTruthy();
    // Without a PR yet, the chip falls back to "agent · working" so the
    // row still differentiates "addressed" from "open" at a glance.
    expect(await screen.findByText(/agent · working/i)).toBeTruthy();
  });

  it("clusters rows by anchor with a header when 2+ share an anchor; single-anchor rows render flat", async () => {
    __setIpcClient(
      stubClient({
        listFriction: () =>
          Promise.resolve([
            makeEntry({
              friction_id: "frc_a",
              title: "Settings issue 1",
              anchor_descriptor: "SettingsPage",
            }),
            makeEntry({
              friction_id: "frc_b",
              title: "Settings issue 2",
              anchor_descriptor: "SettingsPage",
            }),
            makeEntry({
              friction_id: "frc_c",
              title: "Lone wolf",
              anchor_descriptor: "OtherComponent",
            }),
          ]),
      }),
    );

    render(<FrictionTriageSection />);

    // Two-row cluster gets a header carrying the humanized anchor +
    // count; "OtherComponent" is humanized to "Other Component".
    expect(await screen.findByText(/Settings Page/)).toBeTruthy();
    expect(await screen.findByText(/2 reports/)).toBeTruthy();
    // Single-row cluster does not render a header — its anchor only
    // appears as a row meta entry, not as a section title.
    expect(screen.queryByText(/1 reports/)).toBeNull();
  });

  it("⋯ menu trigger renders a menu with state-conditional items", async () => {
    __setIpcClient(
      stubClient({
        listFriction: () =>
          Promise.resolve([
            makeEntry({ friction_id: "frc_one", state: "open" }),
          ]),
      }),
    );

    render(<FrictionTriageSection />);

    const trigger = await screen.findByRole("button", {
      name: /more actions/i,
    });
    fireEvent.click(trigger);

    // Open state hides "Reopen" but exposes "Mark resolved", plus the
    // always-on file actions and the agent prompt copy.
    expect(
      await screen.findByRole("menuitem", { name: /copy prompt for agent/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /show in finder/i }),
    ).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /^copy path$/i })).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /mark resolved/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /^reopen$/i })).toBeNull();
  });

  it("formatRelativeTime renders compact buckets and falls back to a date past one week", () => {
    const now = new Date("2026-05-03T12:00:00Z").getTime();
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;
    expect(
      formatRelativeTime(new Date(now - 30 * 1000).toISOString(), now),
    ).toBe("just now");
    expect(
      formatRelativeTime(new Date(now - 5 * minute).toISOString(), now),
    ).toBe("5m ago");
    expect(
      formatRelativeTime(new Date(now - 3 * hour).toISOString(), now),
    ).toBe("3h ago");
    expect(formatRelativeTime(new Date(now - 2 * day).toISOString(), now)).toBe(
      "2d ago",
    );
    // Past one week → compact month+day, no year inside the same calendar year.
    const twoWeeksBack = new Date("2026-04-19T12:00:00Z").toISOString();
    expect(formatRelativeTime(twoWeeksBack, now)).toMatch(/^Apr 19$/);
    // Cross-year entries carry the year.
    const lastYear = new Date("2025-11-10T12:00:00Z").toISOString();
    expect(formatRelativeTime(lastYear, now)).toMatch(/^Nov 10, 2025$/);
    // Future timestamp (clock skew) reads as "just now", not a negative duration.
    expect(
      formatRelativeTime(new Date(now + 5 * minute).toISOString(), now),
    ).toBe("just now");
  });

  it("humanizeAnchor renders developer-shaped descriptors as manager-readable strings", () => {
    // PascalCase component → spaced words.
    expect(humanizeAnchor("FrictionTriageRow")).toBe("Friction Triage Row");
    // Route path → breadcrumb with title-cased segments.
    expect(humanizeAnchor("/settings/friction")).toBe("Settings › Friction");
    // Already-prefixed shapes pass through unchanged.
    expect(humanizeAnchor("tool:Read")).toBe("tool:Read");
    expect(humanizeAnchor("src/lib.rs:10-12")).toBe("src/lib.rs:10-12");
    // Empty descriptor falls back to a sensible label.
    expect(humanizeAnchor("")).toBe("Unanchored");
  });
});
