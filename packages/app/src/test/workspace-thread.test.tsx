import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceThread } from "../tabs/WorkspaceThread";
import { __setIpcClient, ipcClient, type IpcClient } from "../ipc/client";
import { createMockCore, type MockCore } from "../ipc/mock";
import type { PostMessageRequest, Workspace } from "../ipc/types";

/**
 * Phase 13.D wire — the WorkspaceThread should call
 * `ipcClient().postMessage()` with the workspace id, draft text, and
 * attachments when the user submits the compose dock. The seeded mock
 * core captures every call so tests can assert the exact shape that
 * crossed the wire.
 */
describe("WorkspaceThread → ipcClient.postMessage", () => {
  let originalClient: IpcClient;
  let mock: MockCore;
  let workspace: Workspace;

  beforeEach(() => {
    originalClient = ipcClient();
    mock = createMockCore();
    const project = mock.listProjects()[0];
    workspace = mock.listWorkspaces(project.project.id)[0].workspace;
    __setIpcClient({
      listProjects: () => Promise.resolve(mock.listProjects()),
      createProject: (req) => Promise.resolve(mock.createProject(req)),
      listWorkspaces: (id) => Promise.resolve(mock.listWorkspaces(id)),
      createWorkspace: (req) => Promise.resolve(mock.createWorkspace(req)),
      openTab: (req) => Promise.resolve(mock.openTab(req)),
      closeTab: (ws, t) => Promise.resolve(mock.closeTab(ws, t)),
      spine: (id) => Promise.resolve(mock.spine(id)),
      stream: (handler) => mock.subscribe(handler),
      requestApproval: (ws, gate, summary) =>
        Promise.resolve(mock.requestApproval(ws, gate, summary)),
      resolveApproval: (id, granted, reason) =>
        Promise.resolve(mock.resolveApproval(id, granted, reason)),
      listArtifacts: (ws) => Promise.resolve(mock.listArtifacts(ws)),
      listPinnedArtifacts: (ws) =>
        Promise.resolve(mock.listPinnedArtifacts(ws)),
      getArtifact: (id) => Promise.resolve(mock.getArtifact(id)),
      togglePinArtifact: (id) => Promise.resolve(mock.togglePinArtifact(id)),
      postMessage: (req) => Promise.resolve(mock.postMessage(req)),
    });
  });

  afterEach(() => {
    __setIpcClient(originalClient);
  });

  it("posts a message with the workspace id, text, and (empty) attachments on send", async () => {
    render(<WorkspaceThread workspace={workspace} />);

    const textarea = await waitFor(() =>
      document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
    );
    expect(textarea).not.toBeNull();
    fireEvent.change(textarea!, { target: { value: "Build a sequence diagram" } });

    const sendBtn = document.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );
    expect(sendBtn).not.toBeNull();
    fireEvent.click(sendBtn!);

    await waitFor(() => {
      expect(mock.postedMessages().length).toBe(1);
    });
    const sent: PostMessageRequest = mock.postedMessages()[0];
    expect(sent.workspace_id).toBe(workspace.id);
    expect(sent.text).toBe("Build a sequence diagram");
    expect(sent.attachments).toEqual([]);
  });

  it("does not post on an empty draft", async () => {
    render(<WorkspaceThread workspace={workspace} />);

    const sendBtn = await waitFor(() =>
      document.querySelector<HTMLButtonElement>("button.btn-icon--primary"),
    );
    expect(sendBtn).not.toBeNull();
    fireEvent.click(sendBtn!);

    // ComposeDock guards the empty case before invoking onSend, and
    // WorkspaceThread.onSend guards again. Either way the mock should
    // never see a call.
    expect(mock.postedMessages()).toEqual([]);
  });
});
