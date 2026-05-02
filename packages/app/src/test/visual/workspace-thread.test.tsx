// Visual regression — WorkspaceThread.
//
// Renders the unified thread surface with a representative artifact mix:
// user message, agent reply, two tool-use lines, and a pending approval
// card. Captures the asymmetric authorship treatment, the terse
// tool-line register, and the inline approval chrome simultaneously.

import { afterEach, beforeEach, describe, it } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { WorkspaceThread } from "../../tabs/WorkspaceThread";
import {
  __setIpcClient,
  ipcClient as ipcClientFn,
  type IpcClient,
} from "../../ipc/client";
import {
  createVisualIpcClient,
  fixtureWorkspace,
} from "./fixtures";
import { applyTheme, matchScreenshot, settle } from "./match";

let originalClient: IpcClient;

beforeEach(() => {
  originalClient = ipcClientFn();
  __setIpcClient(createVisualIpcClient());
});

afterEach(() => {
  __setIpcClient(originalClient);
});

async function renderThread() {
  const utils = render(<WorkspaceThread workspace={fixtureWorkspace} />);
  // The thread starts in suggestion mode and only flips to the artifact
  // list once `hasStarted` is true. The fixture seeds artifacts directly,
  // but `hasStarted` is local state — we need a user send (or a manual
  // store mutation) to trip it. The simplest, most realistic path is to
  // wait for the initial artifact load to land and then nudge the
  // component out of suggestion mode by clicking the first suggestion
  // (which sets hasStarted via a draft pick + send).
  //
  // Simpler: render the thread in already-started mode by ensuring
  // artifacts exist, then click the dock send button after a draft is
  // seeded. But that's noisy — instead we forcibly set hasStarted via
  // a synthetic input + Enter keypress would trigger network calls.
  //
  // The cleanest path: wait for `listArtifacts` to populate, then
  // dispatch a custom hasStarted toggle. Since hasStarted is private,
  // we use the suggestion-list click path: clicking a suggestion
  // calls pickSuggestion (sets draft) but does NOT flip hasStarted.
  // So we use the compose-textarea + send approach.

  await waitFor(() => {
    const list =
      document.querySelector(".thread") ||
      document.querySelector(".suggestion-list");
    if (!list) throw new Error("thread surface not rendered");
  });

  // Trigger the suggestion → thread transition by typing + sending.
  // The fixture's postMessage resolves immediately and the artifact list
  // is fixed, so this is deterministic.
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "textarea.compose__input",
  );
  if (textarea) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "Continue");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const sendBtn = document.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );
    sendBtn?.click();
  }

  await waitFor(() => {
    const blocks = document.querySelectorAll(".block, .tool-line");
    if (blocks.length === 0) throw new Error("no blocks rendered yet");
  });
  await settle();
  return utils;
}

describe("WorkspaceThread", () => {
  it("renders artifact mix in light mode", async () => {
    applyTheme("light");
    await renderThread();
    await matchScreenshot("workspace-thread", { variant: "light" });
  });

  it("renders artifact mix in dark mode", async () => {
    applyTheme("dark");
    await renderThread();
    await matchScreenshot("workspace-thread", { variant: "dark" });
  });
});
