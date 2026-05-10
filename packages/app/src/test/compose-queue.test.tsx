// Phase 24 §5.4 — send-while-streaming queue + stop-and-send tests.
//
// Covers the user-perceptible contract:
//   - Pressing ⏎ while a turn is open queues the message instead of
//     sending; ComposeDock clears the textarea, the queue chip
//     renders.
//   - Pressing ⌘⏎ while a turn is open queues + dispatches
//     cmd_interrupt_turn (so the auto-dispatch effect fires when the
//     resulting AgentTurnEnded { Interrupted } arrives).
//   - The SendMenu hover/focus surface mounts only when the
//     subprocess is running for the focused tab.
//   - The queue persists across remount (localStorage round-trip).
//   - clearQueuedMessage drops both the in-memory entry and the
//     localStorage key.
//
// Auto-dispatch on the working→idle transition is exercised
// separately in workspace-thread.test.tsx where the WorkspaceThread
// effect lives. This file pins the ComposeDock+SendMenu surface only.

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposeDock } from "../components/ComposeDock";
import { dataStore } from "../store/data";
import { appStore, setQueuedMessage, clearQueuedMessage } from "../store/app";
import { __setIpcClient } from "../ipc/client";
import { mockIpcClient } from "./ipcMockClient";
import type { TabId, WorkspaceId } from "../ipc/types";

const WS = "ws-q" as WorkspaceId;
const TAB = "tab-q" as TabId;

function setActive(state: "working" | "awaiting_approval" | "idle") {
  dataStore.set((s) => ({
    ...s,
    activity: {
      ...s.activity,
      [`${WS}:${TAB}`]: { state, since_ms: Date.now() },
    },
  }));
}

function setIdle() {
  dataStore.set((s) => {
    const next = { ...s.activity };
    delete next[`${WS}:${TAB}`];
    return { ...s, activity: next };
  });
}

beforeEach(() => {
  __setIpcClient(mockIpcClient());
  localStorage.clear();
  // Reset stores to a known empty baseline so test-order doesn't
  // leak via the singleton appStore / dataStore.
  appStore.set((s) => ({
    ...s,
    queuedMessageByTab: {},
    composerDraftByTab: {},
  }));
  dataStore.set({
    projects: [],
    workspaces: {},
    spines: {},
    events: [],
    recentActivityTs: {},
    activity: {},
    loaded: true,
  });
});

afterEach(() => {
  setIdle();
});

describe("ComposeDock — send when idle (legacy default)", () => {
  it("⏎ dispatches onSend immediately when no turn is open", () => {
    const onSend = vi.fn();
    render(<ComposeDock workspaceId={WS} tabId={TAB} onSend={onSend} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hello" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend.mock.calls[0]![0].text).toBe("hello");
    // Queue must NOT receive the message when idle.
    expect(appStore.get().queuedMessageByTab[TAB]).toBeUndefined();
  });
});

describe("ComposeDock — queue when running (Phase 24 §5.4 default)", () => {
  it("⏎ queues the message instead of dispatching when subprocess is working", () => {
    setActive("working");
    const onSend = vi.fn();
    render(<ComposeDock workspaceId={WS} tabId={TAB} onSend={onSend} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "follow up" } });
    fireEvent.keyDown(textarea, { key: "Enter" });
    expect(onSend).not.toHaveBeenCalled();
    expect(appStore.get().queuedMessageByTab[TAB]).toBe("follow up");
    // Textarea cleared so the user can type the next thing.
    expect(textarea.value).toBe("");
  });

  it("renders the queue chip when queuedMessageByTab[tab] is non-empty", () => {
    setQueuedMessage(TAB, "queued thing");
    render(<ComposeDock workspaceId={WS} tabId={TAB} />);
    expect(screen.getByText("queued thing")).toBeTruthy();
    expect(
      document.querySelector('[data-component="QueuedMessageChip"]'),
    ).not.toBeNull();
  });

  it("clearing via the × button removes the chip", () => {
    setQueuedMessage(TAB, "discardable");
    render(<ComposeDock workspaceId={WS} tabId={TAB} />);
    const cancelBtn = screen.getByLabelText("Discard queued message");
    fireEvent.click(cancelBtn);
    expect(appStore.get().queuedMessageByTab[TAB]).toBeUndefined();
  });
});

describe("ComposeDock — stop-and-send (⌘⏎)", () => {
  it("⌘⏎ queues the message AND dispatches cmd_interrupt_turn", async () => {
    setActive("working");
    const interruptTurn = vi.fn().mockResolvedValue(undefined);
    __setIpcClient({ ...mockIpcClient(), interruptTurn });
    const onSend = vi.fn();
    render(<ComposeDock workspaceId={WS} tabId={TAB} onSend={onSend} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "stop and reroute" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    // Queue captured immediately; onSend NOT called yet (auto-dispatch
    // is the responsibility of WorkspaceThread on the next idle edge).
    expect(onSend).not.toHaveBeenCalled();
    expect(appStore.get().queuedMessageByTab[TAB]).toBe("stop and reroute");
    expect(interruptTurn).toHaveBeenCalledWith(WS, TAB);
  });

  it("falls back to send when no turn is open even with ⌘⏎", () => {
    // Idle subprocess. ⌘⏎ should behave like ⏎ (send immediately) so
    // muscle memory survives. The chord-only path is reserved for
    // mid-stream stop-and-send.
    const onSend = vi.fn();
    render(<ComposeDock workspaceId={WS} tabId={TAB} onSend={onSend} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "ship it" } });
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(appStore.get().queuedMessageByTab[TAB]).toBeUndefined();
  });
});

describe("ComposeDock — SendMenu visibility (Phase 24 §5.4)", () => {
  it("does not mount SendMenu when subprocess is idle", () => {
    render(<ComposeDock workspaceId={WS} tabId={TAB} />);
    expect(document.querySelector('[data-component="SendMenu"]')).toBeNull();
    // The Send button still has the "Send" label, not "Queue".
    expect(screen.getByLabelText("Send")).toBeTruthy();
  });

  it("relabels the Send button when subprocess is running", () => {
    setActive("working");
    render(<ComposeDock workspaceId={WS} tabId={TAB} />);
    expect(screen.getByLabelText("Queue message")).toBeTruthy();
  });
});

describe("Esc priority chain (Phase 24 §5.4.1)", () => {
  it("Esc with queued message discards the queue (rule 4)", () => {
    setActive("working");
    setQueuedMessage(TAB, "queued thing");
    const interruptTurn = vi.fn().mockResolvedValue(undefined);
    __setIpcClient({ ...mockIpcClient(), interruptTurn });
    render(<ComposeDock workspaceId={WS} tabId={TAB} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Escape" });
    // Queue cleared; interrupt NOT called (rule 4 takes precedence
    // over rule 5 — the user discards their unsent text first).
    expect(appStore.get().queuedMessageByTab[TAB]).toBeUndefined();
    expect(interruptTurn).not.toHaveBeenCalled();
    // localStorage must also be cleared — otherwise the queue
    // resurrects on reload (the persisted store backs the in-memory
    // map; clearQueuedMessage must wipe both atomically).
    const persisted = JSON.parse(
      localStorage.getItem("designer.composer.queuedMessageByTab") ?? "{}",
    );
    expect(persisted[TAB]).toBeUndefined();
  });

  it("Esc with no queue but running subprocess interrupts (rule 5)", () => {
    setActive("working");
    const interruptTurn = vi.fn().mockResolvedValue(undefined);
    __setIpcClient({ ...mockIpcClient(), interruptTurn });
    render(<ComposeDock workspaceId={WS} tabId={TAB} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(interruptTurn).toHaveBeenCalledWith(WS, TAB);
  });

  it("Esc with no queue and no running subprocess is a no-op", () => {
    const interruptTurn = vi.fn().mockResolvedValue(undefined);
    __setIpcClient({ ...mockIpcClient(), interruptTurn });
    render(<ComposeDock workspaceId={WS} tabId={TAB} />);
    const textarea = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: "Escape" });
    expect(interruptTurn).not.toHaveBeenCalled();
  });
});

describe("auto-dispatch on working→idle transition (Phase 24 §5.4)", () => {
  // The auto-dispatch effect lives in WorkspaceThread, not ComposeDock.
  // Test it at the unit-of-behavior altitude by asserting the contract
  // via store mutations: setQueuedMessage + activity transition →
  // queuedMessage cleared. Full WorkspaceThread render is out of scope
  // for this file (lives in workspace-thread.test.tsx); these tests
  // cover the store-level invariant the effect relies on.
  it("clearQueuedMessage clears in-memory + localStorage atomically", () => {
    setQueuedMessage(TAB, "auto-dispatched");
    expect(appStore.get().queuedMessageByTab[TAB]).toBe("auto-dispatched");
    expect(
      JSON.parse(
        localStorage.getItem("designer.composer.queuedMessageByTab") ?? "{}",
      )[TAB],
    ).toBe("auto-dispatched");
    clearQueuedMessage(TAB);
    expect(appStore.get().queuedMessageByTab[TAB]).toBeUndefined();
    expect(
      JSON.parse(
        localStorage.getItem("designer.composer.queuedMessageByTab") ?? "{}",
      )[TAB],
    ).toBeUndefined();
  });

  it("queue persists across multiple tabs independently", () => {
    const TAB_B = "tab-q-b" as TabId;
    setQueuedMessage(TAB, "queue-a");
    setQueuedMessage(TAB_B, "queue-b");
    expect(appStore.get().queuedMessageByTab[TAB]).toBe("queue-a");
    expect(appStore.get().queuedMessageByTab[TAB_B]).toBe("queue-b");
    clearQueuedMessage(TAB);
    // B's queue must survive A's clear.
    expect(appStore.get().queuedMessageByTab[TAB]).toBeUndefined();
    expect(appStore.get().queuedMessageByTab[TAB_B]).toBe("queue-b");
  });
});

describe("setQueuedMessage / clearQueuedMessage — store + persistence", () => {
  it("setQueuedMessage trims whitespace and writes to localStorage", () => {
    setQueuedMessage(TAB, "  padded  ");
    expect(appStore.get().queuedMessageByTab[TAB]).toBe("padded");
    expect(
      JSON.parse(
        localStorage.getItem("designer.composer.queuedMessageByTab") ?? "{}",
      )[TAB],
    ).toBe("padded");
  });

  it("setQueuedMessage with empty string deletes the entry (and localStorage)", () => {
    setQueuedMessage(TAB, "x");
    setQueuedMessage(TAB, "   ");
    expect(appStore.get().queuedMessageByTab[TAB]).toBeUndefined();
    const persisted = JSON.parse(
      localStorage.getItem("designer.composer.queuedMessageByTab") ?? "{}",
    );
    expect(persisted[TAB]).toBeUndefined();
  });

  it("clearQueuedMessage is idempotent on missing keys", () => {
    expect(() => clearQueuedMessage(TAB)).not.toThrow();
    expect(appStore.get().queuedMessageByTab[TAB]).toBeUndefined();
  });
});
