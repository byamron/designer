import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RepoUnlinkModal } from "../components/RepoUnlinkModal";
import { __setIpcClient } from "../ipc/client";
import { createMockCore } from "../ipc/mock";

function makeClient() {
  const core = createMockCore();
  const unlinkCalls: string[] = [];
  __setIpcClient({
    listProjects: () => Promise.resolve(core.listProjects()),
    createProject: (req) => Promise.resolve(core.createProject(req)),
    listWorkspaces: (id) => Promise.resolve(core.listWorkspaces(id)),
    createWorkspace: (req) => Promise.resolve(core.createWorkspace(req)),
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
    listArtifactsInTab: (ws, t) => Promise.resolve(core.listArtifactsInTab(ws, t)),
    listSpineArtifacts: (ws) => Promise.resolve(core.listArtifacts(ws)),
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
    unlinkRepo: (req) => {
      unlinkCalls.push(req.workspace_id);
      core.unlinkRepo(req);
      return Promise.resolve();
    },
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
  });
  const project = core.listProjects()[0];
  const workspace = core.listWorkspaces(project.project.id)[0];
  return { core, workspace, unlinkCalls };
}

describe("RepoUnlinkModal", () => {
  it("renders the repo path and the irreversible-but-safe explanation", () => {
    const { workspace } = makeClient();
    render(
      <RepoUnlinkModal
        workspaceIds={[workspace.workspace.id]}
        repoPath="/Users/me/code/example"
        open={true}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/will no longer track/i)).toBeTruthy();
    expect(screen.getByText("/Users/me/code/example")).toBeTruthy();
    expect(screen.getByText(/repo files are not touched/i)).toBeTruthy();
  });

  it("Confirm calls cmd_unlink_repo for each workspace and closes the modal", async () => {
    const { workspace, unlinkCalls } = makeClient();
    const onClose = vi.fn();
    const onUnlinked = vi.fn();
    render(
      <RepoUnlinkModal
        workspaceIds={[workspace.workspace.id]}
        repoPath="/Users/me/code/example"
        open={true}
        onClose={onClose}
        onUnlinked={onUnlinked}
      />,
    );
    fireEvent.click(screen.getByText("Disconnect"));
    await waitFor(() => {
      expect(onUnlinked).toHaveBeenCalledTimes(1);
    });
    expect(unlinkCalls).toEqual([workspace.workspace.id]);
    expect(onClose).toHaveBeenCalled();
  });

  it("Cancel dismisses without calling cmd_unlink_repo", () => {
    const { workspace, unlinkCalls } = makeClient();
    const onClose = vi.fn();
    render(
      <RepoUnlinkModal
        workspaceIds={[workspace.workspace.id]}
        repoPath="/Users/me/code/example"
        open={true}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(unlinkCalls).toEqual([]);
  });

  it("fans out across multiple workspaces in one confirm", async () => {
    const { core, unlinkCalls } = makeClient();
    const project = core.listProjects()[0];
    // Mock seeds one workspace; create one more so the fan-out is testable.
    const second = core.createWorkspace({
      project_id: project.project.id,
      name: "second",
      base_branch: "main",
    });
    const ids = core
      .listWorkspaces(project.project.id)
      .map((w) => w.workspace.id);
    expect(ids).toContain(second.workspace.id);
    const onClose = vi.fn();
    render(
      <RepoUnlinkModal
        workspaceIds={ids}
        repoPath="/Users/me/code/example"
        open={true}
        onClose={onClose}
      />,
    );
    fireEvent.click(screen.getByText("Disconnect"));
    await waitFor(() => {
      expect(unlinkCalls.length).toBe(ids.length);
    });
    expect(unlinkCalls).toEqual(ids);
  });
});
