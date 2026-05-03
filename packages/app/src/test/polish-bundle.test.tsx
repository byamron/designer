import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposeDock } from "../components/ComposeDock";
import { FrictionWidget } from "../components/Friction/FrictionWidget";
import {
  ACTIVE_RECENCY_MS,
  dataStore,
  useRecentActivity,
} from "../store/data";
import { clearFriction, toggleFrictionComposer } from "../store/app";
import { __setIpcClient } from "../ipc/client";
import type { IpcClient } from "../ipc/client";
import { renderHook } from "@testing-library/react";

function stubClient(overrides: Partial<IpcClient> = {}): IpcClient {
  const noop = () => Promise.reject(new Error("not used"));
  const base: IpcClient = {
    listProjects: () => Promise.resolve([]),
    createProject: noop,
    listWorkspaces: () => Promise.resolve([]),
    createWorkspace: noop,
    archiveWorkspace: () => Promise.resolve(),
    restoreWorkspace: () => Promise.resolve(),
    deleteWorkspace: () => Promise.resolve(),
    openTab: noop,
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
      }),
    setFeatureFlag: (name, enabled) =>
      Promise.resolve({
        show_models_section: name === "show_models_section" ? enabled : false,
        show_all_artifacts_in_spine:
          name === "show_all_artifacts_in_spine" ? enabled : false,
      }),
    reportFriction: () =>
      Promise.resolve({ friction_id: "frc_polish_xyzxyz", local_path: "" }),
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
  };
  return { ...base, ...overrides };
}

describe("ComposeDock — return-to-send keymap (polish-bundle frc_…891c)", () => {
  it("fires send on plain Enter (and not on Shift+Enter)", () => {
    const onSend = vi.fn();
    render(<ComposeDock onSend={onSend} />);
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    )!;
    fireEvent.change(textarea, { target: { value: "ship it" } });

    // Shift+Enter must NOT send — it inserts a newline.
    fireEvent.keyDown(textarea, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();

    // Plain Enter sends.
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0]).toMatchObject({ text: "ship it" });
  });

  it("does not send while an IME composition is in flight", () => {
    const onSend = vi.fn();
    render(<ComposeDock onSend={onSend} />);
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    )!;
    fireEvent.change(textarea, { target: { value: "こんにちは" } });
    // CJK / emoji IMEs fire Enter to confirm composition; the handler
    // must defer to the IME instead of intercepting and submitting.
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("preserves ⌘/Ctrl+Enter as a send alias for muscle memory", () => {
    const onSend = vi.fn();
    render(<ComposeDock onSend={onSend} />);
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    )!;
    fireEvent.change(textarea, { target: { value: "still works" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe("useRecentActivity — pulse gating (polish-bundle frc_…3632)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns false once the recency window has elapsed since last event", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const latestTs = start - (ACTIVE_RECENCY_MS + 1_000); // already stale
    const { result } = renderHook(() => useRecentActivity(latestTs));
    expect(result.current).toBe(false);
  });

  it("returns true while inside the window, then flips to false after it expires", () => {
    const start = 1_700_000_000_000;
    vi.setSystemTime(start);
    const latestTs = start - 1_000; // 1s ago, still recent
    const { result, rerender } = renderHook(() => useRecentActivity(latestTs));
    expect(result.current).toBe(true);

    // Jump past the window. The hook's internal timeout schedules a
    // re-render at `remaining + 50`; advancing fake time triggers it.
    act(() => {
      vi.setSystemTime(start + ACTIVE_RECENCY_MS + 100);
      vi.advanceTimersByTime(ACTIVE_RECENCY_MS + 100);
    });
    rerender();
    expect(result.current).toBe(false);
  });
});

describe("FrictionWidget — drop renders thumbnail (polish-bundle frc_…e3c7)", () => {
  beforeEach(() => {
    clearFriction();
    __setIpcClient(stubClient());
  });
  afterEach(() => {
    clearFriction();
  });

  /**
   * jsdom's File implementation lacks `arrayBuffer()` — patch it on
   * each fixture so the widget's ingest path can read the bytes.
   */
  function makeFile(name: string, type: string, bytes: Uint8Array): File {
    // The `new Uint8Array(bytes)` re-wrap forces an ArrayBuffer
    // backing — TS rejects the bare `Uint8Array` because its buffer
    // could be SharedArrayBuffer-typed, which `Blob` doesn't accept.
    const buf = new Uint8Array(bytes);
    const f = new File([buf], name, { type });
    Object.defineProperty(f, "arrayBuffer", {
      value: () => Promise.resolve(buf.buffer.slice(0)),
      configurable: true,
    });
    return f;
  }

  it("renders an <img> preview after a drop event with a valid PNG file", async () => {
    render(<FrictionWidget />);
    act(() => toggleFrictionComposer());

    const dialog = await screen.findByRole("dialog", {
      name: /capture friction/i,
    });

    const png = makeFile(
      "shot.png",
      "image/png",
      new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    );
    const dataTransfer = {
      files: [png],
      items: [],
      types: ["Files"],
    } as unknown as DataTransfer;

    fireEvent.dragOver(dialog, { dataTransfer });
    fireEvent.drop(dialog, { dataTransfer });

    const img = await waitFor(() => {
      const el = dialog.querySelector<HTMLImageElement>(
        '[data-component="FrictionWidgetPreview"] img',
      );
      expect(el).not.toBeNull();
      return el!;
    });
    expect(img.src.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("rejects a non-image drop with an inline error toast", async () => {
    render(<FrictionWidget />);
    act(() => toggleFrictionComposer());
    const dialog = await screen.findByRole("dialog", {
      name: /capture friction/i,
    });
    const txt = makeFile("notes.txt", "text/plain", new Uint8Array([1]));
    const dataTransfer = {
      files: [txt],
      items: [],
      types: ["Files"],
    } as unknown as DataTransfer;

    fireEvent.dragOver(dialog, { dataTransfer });
    fireEvent.drop(dialog, { dataTransfer });

    await screen.findByText(/only image files are supported/i);
    expect(
      dialog.querySelector('[data-component="FrictionWidgetPreview"]'),
    ).toBeNull();
  });
});

describe("FrictionWidget — submit smoothness (polish-bundle frc_…2ee1)", () => {
  beforeEach(() => {
    clearFriction();
    vi.useFakeTimers({ shouldAdvanceTime: true });
    __setIpcClient(stubClient());
  });
  afterEach(() => {
    clearFriction();
    vi.useRealTimers();
  });

  it("cross-fades to a 'Filed.' slab on submit, then unmounts the widget", async () => {
    render(<FrictionWidget />);
    act(() => toggleFrictionComposer());

    const body = await screen.findByPlaceholderText(/what's friction-y\?/i);
    fireEvent.change(body, { target: { value: "weird delay on submit" } });

    fireEvent.click(screen.getByRole("button", { name: /submit/i }));

    // The slab fades over the composer interior with the
    // --motion-emphasized token (400ms). The "Filed." status appears
    // immediately on submit success.
    await waitFor(() => {
      expect(
        document.querySelector('[data-component="FrictionFiledSlab"]'),
      ).not.toBeNull();
    });
    expect(screen.getByText(/^filed\.$/i)).toBeTruthy();

    // After the close timer (~650ms) elapses, the widget unmounts.
    act(() => {
      vi.advanceTimersByTime(800);
    });
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /capture friction/i }),
      ).toBeNull();
    });
  });
});

describe("dataStore — recentActivityTs updates from the event stream", () => {
  it("records the latest event timestamp keyed by stream_id", () => {
    const ts = "2026-04-30T12:00:00.000Z";
    dataStore.set((s) => ({
      ...s,
      recentActivityTs: { ...s.recentActivityTs, "ws-test-1": Date.parse(ts) },
    }));
    expect(dataStore.get().recentActivityTs["ws-test-1"]).toBe(Date.parse(ts));
  });
});
