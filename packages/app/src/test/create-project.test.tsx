import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CreateProjectModal } from "../components/CreateProjectModal";
import { __setIpcClient } from "../ipc/client";
import { createMockCore } from "../ipc/mock";
import { appStore, openCreateProject, closeCreateProject } from "../store/app";

function makeClient() {
  const core = createMockCore();
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
    listArtifactsInTab: (ws, t) => Promise.resolve(core.listArtifactsInTab(ws, t)),
    listSpineArtifacts: (ws) => Promise.resolve(core.listSpineArtifacts(ws)),
    listPinnedArtifacts: (ws) => Promise.resolve(core.listPinnedArtifacts(ws)),
    getArtifact: (id) => Promise.resolve(core.getArtifact(id)),
    togglePinArtifact: (id) => Promise.resolve(core.togglePinArtifact(id)),
    postMessage: (req) => Promise.resolve(core.postMessage(req)),
    linkRepo: (req) => Promise.resolve(core.linkRepo(req)),
    unlinkRepo: (req) => Promise.resolve(core.unlinkRepo(req)),
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
}

describe("CreateProjectModal", () => {
  it("renders nothing when dialog is not 'create-project'", () => {
    closeCreateProject();
    makeClient();
    const { container } = render(<CreateProjectModal />);
    expect(container.firstChild).toBeNull();
  });

  it("submits with autofilled name from path basename", async () => {
    makeClient();
    openCreateProject();
    const onCreated = vi.fn();
    render(<CreateProjectModal onCreated={onCreated} />);
    const pathInput = screen.getByLabelText("Project folder") as HTMLInputElement;
    fireEvent.change(pathInput, {
      target: { value: "/Users/me/code/example" },
    });
    // Name should auto-derive from the path's basename.
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    expect(nameInput.value).toBe("example");

    fireEvent.click(screen.getByText("Create project"));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    // Modal closes after success.
    expect(appStore.get().dialog).toBe(null);
  });

  it("lets the user override the auto-name", () => {
    makeClient();
    openCreateProject();
    render(<CreateProjectModal />);
    const pathInput = screen.getByLabelText("Project folder") as HTMLInputElement;
    fireEvent.change(pathInput, { target: { value: "/Users/me/code/foo" } });
    const nameInput = screen.getByLabelText("Name") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "My Custom Name" } });
    expect(nameInput.value).toBe("My Custom Name");
    // Changing the path afterwards should NOT clobber the user's override.
    fireEvent.change(pathInput, { target: { value: "/Users/me/code/bar" } });
    expect(nameInput.value).toBe("My Custom Name");
    closeCreateProject();
  });

  it("disables submit while either field is empty", () => {
    makeClient();
    openCreateProject();
    render(<CreateProjectModal />);
    const submit = screen.getByText("Create project") as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Project folder"), {
      target: { value: "/x/y" },
    });
    expect((screen.getByText("Create project") as HTMLButtonElement).disabled).toBe(
      false,
    );
    closeCreateProject();
  });

  it("uses the dialog discriminant from app store", () => {
    makeClient();
    closeCreateProject();
    expect(appStore.get().dialog).toBe(null);
    openCreateProject();
    expect(appStore.get().dialog).toBe("create-project");
    closeCreateProject();
    expect(appStore.get().dialog).toBe(null);
  });
});
