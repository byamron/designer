import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RepoLinkModal } from "../components/RepoLinkModal";
import { __setIpcClient } from "../ipc/client";
import { createMockCore } from "../ipc/mock";

function makeClient() {
  const core = createMockCore();
  // Reuse the seeded mock to mirror production wiring.
  __setIpcClient({
    listProjects: () => Promise.resolve(core.listProjects()),
    createProject: (req) => Promise.resolve(core.createProject(req)),
    listWorkspaces: (id) => Promise.resolve(core.listWorkspaces(id)),
    createWorkspace: (req) => Promise.resolve(core.createWorkspace(req)),
    renameWorkspace: (id, name) =>
      Promise.resolve(core.renameWorkspace(id, name)),
    renameTab: (w, t, title) => Promise.resolve(core.renameTab(w, t, title)),
    archiveWorkspace: (id) => Promise.resolve(core.archiveWorkspace(id)),
    restoreWorkspace: (id) => Promise.resolve(core.restoreWorkspace(id)),
    deleteWorkspace: (id) => Promise.resolve(core.deleteWorkspace(id)),
    openTab: (req) => Promise.resolve(core.openTab(req)),
    closeTab: (ws, tab) => {
      core.closeTab(ws, tab);
      return Promise.resolve();
    },
    spine: (id) => Promise.resolve(core.spine(id)),
    stream: (h) => core.subscribe(h),
    activityStream: () => () => {},
    requestApproval: (ws, gate, summary) =>
      Promise.resolve(core.requestApproval(ws, gate, summary)),
    resolveApproval: (id, granted, reason) => {
      core.resolveApproval(id, granted, reason);
      return Promise.resolve();
    },
    listArtifacts: (ws) => Promise.resolve(core.listArtifacts(ws)),
    listArtifactsInTab: (ws, t) =>
      Promise.resolve(core.listArtifactsInTab(ws, t)),
    listSpineArtifacts: (ws) => Promise.resolve(core.listSpineArtifacts(ws)),
    listPinnedArtifacts: (ws) => Promise.resolve(core.listPinnedArtifacts(ws)),
    getArtifact: (id) => Promise.resolve(core.getArtifact(id)),
    togglePinArtifact: (id) => Promise.resolve(core.togglePinArtifact(id)),
    postMessage: (req) => Promise.resolve(core.postMessage(req)),
    interruptTurn: (workspaceId, tabId) => {
      core.interruptTurn(workspaceId, tabId);
      return Promise.resolve();
    },
    linkRepo: (req) =>
      new Promise((resolve, reject) => {
        try {
          core.linkRepo(req);
          resolve();
        } catch (e) {
          reject(e);
        }
      }),
    unlinkRepo: (req) => Promise.resolve(core.unlinkRepo(req)),
    startTrack: (req) => Promise.resolve(core.startTrack(req)),
    requestMerge: (req) => Promise.resolve(core.requestMerge(req)),
    completeTrack: (req) => {
      core.completeTrack?.(req);
      return Promise.resolve();
    },
    listTracks: (ws) => Promise.resolve(core.listTracks(ws)),
    getTrack: (id) => Promise.resolve(core.getTrack(id)),
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
  });
  const project = core.listProjects()[0];
  const workspace = core.listWorkspaces(project.project.id)[0];
  return { core, workspace };
}

describe("RepoLinkModal", () => {
  it("submits a valid path via cmd_link_repo and closes", async () => {
    const { workspace } = makeClient();
    const onClose = vi.fn();
    const onLinked = vi.fn();
    render(
      <RepoLinkModal
        workspaceId={workspace.workspace.id}
        open={true}
        onClose={onClose}
        onLinked={onLinked}
      />,
    );
    const input = screen.getByLabelText(
      "Absolute path to the repository",
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "/Users/me/code/example" } });
    fireEvent.click(screen.getByText("Link repository"));
    await waitFor(() => {
      expect(onLinked).toHaveBeenCalledWith("/Users/me/code/example");
    });
    expect(onClose).toHaveBeenCalled();
  });

  it("shows an error when the path is rejected", async () => {
    const { workspace } = makeClient();
    const onClose = vi.fn();
    render(
      <RepoLinkModal
        workspaceId={workspace.workspace.id}
        open={true}
        onClose={onClose}
      />,
    );
    const input = screen.getByLabelText(
      "Absolute path to the repository",
    ) as HTMLInputElement;
    // Mock rejects relative paths as "not a git repository".
    fireEvent.change(input, { target: { value: "relative/path" } });
    fireEvent.click(screen.getByText("Link repository"));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("not a git repository");
    expect(onClose).not.toHaveBeenCalled();
  });

  it("requires a non-empty path", async () => {
    const { workspace } = makeClient();
    const onClose = vi.fn();
    render(
      <RepoLinkModal
        workspaceId={workspace.workspace.id}
        open={true}
        onClose={onClose}
      />,
    );
    // The submit button is disabled while the input is empty.
    const submit = screen.getByText("Link repository") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("traps Tab focus inside the dialog", async () => {
    const { workspace } = makeClient();
    const onClose = vi.fn();
    render(
      <RepoLinkModal
        workspaceId={workspace.workspace.id}
        open={true}
        onClose={onClose}
      />,
    );
    const dialog = screen.getByRole("dialog");
    // Collect the focusable elements in DOM order: Close icon, input,
    // Cancel button. (The "Link repository" submit is disabled while the
    // input is empty, so it's not in the focus ring.)
    const focusables = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled]), input:not([disabled])",
      ),
    );
    expect(focusables.length).toBeGreaterThanOrEqual(2);
    const last = focusables[focusables.length - 1];
    last.focus();
    expect(document.activeElement).toBe(last);
    // Tab from last → first.
    fireEvent.keyDown(window, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
    // Shift-Tab from first → last.
    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("scrim dismiss uses click, not mousedown — a drag that ends on the scrim does not dismiss", () => {
    const { workspace } = makeClient();
    const onClose = vi.fn();
    const { container } = render(
      <RepoLinkModal
        workspaceId={workspace.workspace.id}
        open={true}
        onClose={onClose}
      />,
    );
    const scrim = container.querySelector(".app-dialog-scrim") as HTMLElement;
    // mousedown alone (the old behavior) must not trigger dismiss.
    fireEvent.mouseDown(scrim);
    expect(onClose).not.toHaveBeenCalled();
    // click (mousedown + mouseup on the same target) does dismiss.
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalled();
  });
});

import { vi } from "vitest";
