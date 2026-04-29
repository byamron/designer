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
    openTab: (req) => Promise.resolve(core.openTab(req)),
    closeTab: (ws, tab) => {
      core.closeTab(ws, tab);
      return Promise.resolve();
    },
    spine: (id) => Promise.resolve(core.spine(id)),
    stream: (h) => core.subscribe(h),
    requestApproval: (ws, gate, summary) =>
      Promise.resolve(core.requestApproval(ws, gate, summary)),
    resolveApproval: (id, granted, reason) => {
      core.resolveApproval(id, granted, reason);
      return Promise.resolve();
    },
    listArtifacts: (ws) => Promise.resolve(core.listArtifacts(ws)),
    listPinnedArtifacts: (ws) => Promise.resolve(core.listPinnedArtifacts(ws)),
    getArtifact: (id) => Promise.resolve(core.getArtifact(id)),
    togglePinArtifact: (id) => Promise.resolve(core.togglePinArtifact(id)),
    postMessage: (req) => Promise.resolve(core.postMessage(req)),
    linkRepo: (req) =>
      new Promise((resolve, reject) => {
        try {
          core.linkRepo(req);
          resolve();
        } catch (e) {
          reject(e);
        }
      }),
    startTrack: (req) => Promise.resolve(core.startTrack(req)),
    requestMerge: (req) => Promise.resolve(core.requestMerge(req)),
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
    reportFriction: () =>
      Promise.resolve({ friction_id: "frc_stub", local_path: "" }),
    listFriction: () => Promise.resolve([]),
    resolveFriction: () => Promise.resolve(),
    addressFriction: () => Promise.resolve(),
    reopenFriction: () => Promise.resolve(),
    captureViewport: () => Promise.resolve(new Uint8Array()),
    revealInFinder: () => Promise.resolve(),
    listFindings: () => Promise.resolve([]),
    signalFinding: () => Promise.resolve(),
    listProposals: () => Promise.resolve([]),
    resolveProposal: () => Promise.resolve(),
    signalProposal: () => Promise.resolve(),
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
    const scrim = container.querySelector(
      ".app-dialog-scrim",
    ) as HTMLElement;
    // mousedown alone (the old behavior) must not trigger dismiss.
    fireEvent.mouseDown(scrim);
    expect(onClose).not.toHaveBeenCalled();
    // click (mousedown + mouseup on the same target) does dismiss.
    fireEvent.click(scrim);
    expect(onClose).toHaveBeenCalled();
  });
});

import { vi } from "vitest";
