// Visual regression — Approval inbox.
//
// Designer doesn't have a standalone inbox page yet (FB tracked); the
// canonical "approval inbox" surface today is a thread containing one or
// more pending ApprovalBlock cards. We render that surface in isolation
// so the approval chrome (kind badge, summary, Grant/Deny actions) is
// the dominant signal in the screenshot.

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
  inboxFixtureOverrides,
} from "./fixtures";
import { applyTheme, matchScreenshot, settle } from "./match";

let originalClient: IpcClient;

beforeEach(() => {
  originalClient = ipcClientFn();
  __setIpcClient(createVisualIpcClient(inboxFixtureOverrides));
});

afterEach(() => {
  __setIpcClient(originalClient);
});

async function renderInbox() {
  render(<WorkspaceThread workspace={fixtureWorkspace} />);
  await waitFor(() => {
    if (!document.querySelector(".thread, .suggestion-list")) {
      throw new Error("thread surface not rendered");
    }
  });

  // Same approach as workspace-thread.test: nudge the surface out of
  // suggestion mode so the artifacts (the approvals) render as blocks.
  const textarea = document.querySelector<HTMLTextAreaElement>(
    "textarea.compose__input",
  );
  if (textarea) {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(textarea, "Review approvals");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const sendBtn = document.querySelector<HTMLButtonElement>(
      "button.btn-icon--primary",
    );
    sendBtn?.click();
  }

  // Wait until the approval cards have rendered AND their payloads have
  // been fetched (lazy on expand — but pending state shows even without
  // expansion, so we just wait for the cards themselves).
  await waitFor(() => {
    const cards = document.querySelectorAll(".block--approval");
    if (cards.length < 2) {
      throw new Error(
        `expected 2 approval cards, got ${cards.length}`,
      );
    }
  });
  await settle();
}

describe("Approval inbox", () => {
  it("renders queued approvals in light mode", async () => {
    applyTheme("light");
    await renderInbox();
    await matchScreenshot("approval-inbox", { variant: "light" });
  });

  it("renders queued approvals in dark mode", async () => {
    applyTheme("dark");
    await renderInbox();
    await matchScreenshot("approval-inbox", { variant: "dark" });
  });
});
