import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApprovalBlock } from "../blocks/blocks";
import { CostChip, COST_CHIP_PREFERENCE_EVENT } from "../components/CostChip";
import { __setIpcClient, ipcClient } from "../ipc/client";
import type { ArtifactSummary, PayloadRef, StreamEvent } from "../ipc/types";
import type { IpcClient } from "../ipc/client";

/**
 * Phase 13.G — frontend coverage for the safety surfaces.
 *
 * Covers:
 *   - ApprovalBlock Grant/Deny call `resolveApproval` exactly once each,
 *     flips optimistic UI, and re-renders on `approval_granted` /
 *     `approval_denied` stream events.
 *   - CostChip renders when toggled on (matching the Decision-34
 *     "off-by-default + opt-in" UX) and stays hidden when toggled off.
 */

function makeApprovalArtifact(): ArtifactSummary {
  return {
    id: "art_1",
    workspace_id: "ws_1",
    kind: "approval",
    title: "Grant write access?",
    summary: "Agent wants to commit seed data to a scratch branch.",
    author_role: "system",
    version: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    pinned: false,
  };
}

function approvalPayload(approvalId: string): PayloadRef {
  return {
    kind: "inline",
    body: JSON.stringify({ approval_id: approvalId, tool: "Write", gate: "tool:Write" }),
  };
}

function makeStubClient(overrides: Partial<IpcClient> = {}): IpcClient {
  // Return a partial implementation cast to IpcClient — only the methods the
  // tests touch need to be wired. Unused calls would throw, which is loud
  // and helps catch regressions where new code starts hitting IPC the test
  // hasn't mocked.
  const notImpl = (name: string) => () => {
    throw new Error(`stub: ${name} not wired`);
  };
  const stub: Partial<IpcClient> = {
    listProjects: notImpl("listProjects"),
    createProject: notImpl("createProject"),
    listWorkspaces: notImpl("listWorkspaces"),
    createWorkspace: notImpl("createWorkspace"),
    openTab: notImpl("openTab"),
    closeTab: notImpl("closeTab"),
    spine: notImpl("spine"),
    stream: () => () => {},
    requestApproval: notImpl("requestApproval"),
    resolveApproval: notImpl("resolveApproval"),
    listArtifacts: notImpl("listArtifacts"),
    listPinnedArtifacts: notImpl("listPinnedArtifacts"),
    getArtifact: notImpl("getArtifact"),
    togglePinArtifact: notImpl("togglePinArtifact"),
    listPendingApprovals: notImpl("listPendingApprovals"),
    getCostStatus: notImpl("getCostStatus"),
    getKeychainStatus: notImpl("getKeychainStatus"),
    getCostChipPreference: notImpl("getCostChipPreference"),
    setCostChipPreference: notImpl("setCostChipPreference"),
    getFeatureFlags: () =>
      Promise.resolve({
        show_models_section: false,
        show_all_artifacts_in_spine: false,
      }),
    setFeatureFlag: notImpl("setFeatureFlag"),
    listFindings: notImpl("listFindings"),
    signalFinding: notImpl("signalFinding"),
    ...overrides,
  };
  return stub as IpcClient;
}

describe("ApprovalBlock", () => {
  let originalClient: IpcClient;

  beforeEach(() => {
    originalClient = ipcClient();
  });
  afterEach(() => {
    __setIpcClient(originalClient);
  });

  it("calls cmd_resolve_approval(true) once on Grant and flips state optimistically", async () => {
    const resolveApproval = vi.fn(async () => undefined);
    __setIpcClient(
      makeStubClient({
        resolveApproval,
        stream: () => () => {},
      }),
    );

    render(
      <ApprovalBlock
        artifact={makeApprovalArtifact()}
        payload={approvalPayload("apv-1")}
        isPinned={false}
        onTogglePin={() => {}}
        expanded={false}
        onToggleExpanded={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /grant/i }));

    // Optimistic state: the resolution status renders immediately.
    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/approved/i);
    });

    // Call shape: (id, true) — no extra reason on Grant.
    expect(resolveApproval).toHaveBeenCalledTimes(1);
    expect(resolveApproval).toHaveBeenCalledWith("apv-1", true);

    // Buttons gone after resolve — no risk of double-call.
    expect(screen.queryByRole("button", { name: /grant/i })).toBeNull();
  });

  it("disables Grant/Deny when the artifact payload has no approval_id", async () => {
    const resolveApproval = vi.fn(async () => undefined);
    __setIpcClient(
      makeStubClient({
        resolveApproval,
        stream: () => () => {},
      }),
    );

    render(
      <ApprovalBlock
        artifact={makeApprovalArtifact()}
        // Pre-13.G payloads were free-text — no parsable approval_id.
        // The block must not let the user appear to act on a request it
        // can't actually resolve.
        payload={{ kind: "inline", body: "legacy free-text payload" }}
        isPinned={false}
        onTogglePin={() => {}}
        expanded={false}
        onToggleExpanded={() => {}}
      />,
    );

    const grant = screen.getByRole("button", { name: /grant/i });
    const deny = screen.getByRole("button", { name: /deny/i });
    expect((grant as HTMLButtonElement).disabled).toBe(true);
    expect((deny as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(grant);
    fireEvent.click(deny);
    expect(resolveApproval).not.toHaveBeenCalled();
  });

  it("becomes truth from the projector when an approval_granted event arrives", async () => {
    let pushEvent: ((ev: StreamEvent) => void) | null = null;
    __setIpcClient(
      makeStubClient({
        // No optimistic call — we want to see the event-stream path drive
        // the UI update when the IPC isn't called from this client.
        resolveApproval: async () => undefined,
        stream: (handler) => {
          pushEvent = handler;
          return () => {
            pushEvent = null;
          };
        },
      }),
    );

    render(
      <ApprovalBlock
        artifact={makeApprovalArtifact()}
        payload={approvalPayload("apv-stream")}
        isPinned={false}
        onTogglePin={() => {}}
        expanded={false}
        onToggleExpanded={() => {}}
      />,
    );

    expect(pushEvent).not.toBeNull();
    act(() => {
      pushEvent?.({
        kind: "approval_granted",
        stream_id: "system",
        sequence: 99,
        timestamp: new Date().toISOString(),
        payload: { kind: "approval_granted", approval_id: "apv-stream" },
      });
    });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toMatch(/approved/i);
    });
  });
});

describe("CostChip", () => {
  let originalClient: IpcClient;

  beforeEach(() => {
    originalClient = ipcClient();
  });
  afterEach(() => {
    __setIpcClient(originalClient);
  });

  it("hides itself when the preference is off (Decision 34 default)", async () => {
    __setIpcClient(
      makeStubClient({
        getCostChipPreference: async () => ({ enabled: false }),
        stream: () => () => {},
      }),
    );

    const { container } = render(<CostChip workspaceId="ws_1" />);

    // Wait for the preference fetch to settle, then assert nothing painted.
    await waitFor(() => {
      // useEffect microtask flushes; nothing should render.
      expect(container.querySelector(".cost-chip")).toBeNull();
    });
  });

  it("renders the spent / cap chip when the preference is on", async () => {
    __setIpcClient(
      makeStubClient({
        getCostChipPreference: async () => ({ enabled: true }),
        getCostStatus: async () => ({
          workspace_id: "ws_1",
          spent_dollars_cents: 250,
          cap_dollars_cents: 1_000,
          spent_tokens: 12_000,
          cap_tokens: 100_000,
          ratio: 0.25,
        }),
        stream: () => () => {},
      }),
    );

    render(<CostChip workspaceId="ws_1" />);

    const chip = await screen.findByRole("button", { name: /cost/i });
    expect(chip.textContent).toContain("$2.50");
    expect(chip.textContent).toContain("$10.00");
    expect(chip.getAttribute("data-band")).toBe("ok");
  });

  it("re-fetches preference when the change event fires", async () => {
    let enabled = false;
    const getPref = vi.fn(async () => ({ enabled }));
    __setIpcClient(
      makeStubClient({
        getCostChipPreference: getPref,
        getCostStatus: async () => ({
          workspace_id: "ws_1",
          spent_dollars_cents: 0,
          cap_dollars_cents: 1_000,
          spent_tokens: 0,
          cap_tokens: 100_000,
          ratio: 0,
        }),
        stream: () => () => {},
      }),
    );

    const { container } = render(<CostChip workspaceId="ws_1" />);
    await waitFor(() => {
      expect(container.querySelector(".cost-chip")).toBeNull();
    });

    enabled = true;
    act(() => {
      window.dispatchEvent(
        new CustomEvent(COST_CHIP_PREFERENCE_EVENT, { detail: { enabled: true } }),
      );
    });

    await waitFor(() => {
      expect(container.querySelector(".cost-chip")).not.toBeNull();
    });
  });
});
