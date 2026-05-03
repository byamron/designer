import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../App";
import { appStore } from "../store/app";
import { __setIpcClient, ipcClient, type IpcClient } from "../ipc/client";
import type { StreamEvent } from "../ipc/types";

beforeEach(() => {
  // Start each test with a clean localStorage so onboarding shows predictably.
  localStorage.clear();
  // The app store is a module singleton; reset transient selection state
  // so tests don't leak through it.
  appStore.set((s) => ({
    ...s,
    activeProject: null,
    activeWorkspace: null,
    activeTabByWorkspace: {},
  }));
});

async function boot() {
  render(<App />);
  await waitFor(() => screen.getByLabelText("Projects"));
  // Dismiss onboarding if it's shown (first launch).
  const dialog = screen.queryByRole("dialog", { name: /welcome/i });
  if (dialog) {
    fireEvent.click(screen.getByRole("button", { name: /skip/i }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /welcome/i })).toBeNull();
    });
  }
}

describe("Project home", () => {
  it("renders the active project name in the sidebar on boot", async () => {
    await boot();
    // After the UX pass the project title lives only in the sidebar (no
    // duplicated topbar heading). `sidebar-title` is the canonical anchor.
    await waitFor(() => {
      const title = document.querySelector(".sidebar-title");
      expect(title?.textContent).toBe("Designer");
    });
  });

  it("renders a project-home region", async () => {
    await boot();
    await waitFor(() => {
      const region = document.getElementById("project-home");
      expect(region).not.toBeNull();
      expect(region?.getAttribute("role")).toBe("region");
    });
  });
});

describe("Workspace tabs", () => {
  it("shows role=tabpanel wired to the active tab after selecting a workspace", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    const row = document.querySelector<HTMLButtonElement>("button.workspace-row");
    fireEvent.click(row!);
    await waitFor(() => {
      const panel = document.querySelector('[role="tabpanel"]');
      expect(panel).not.toBeNull();
      const tabId = panel?.getAttribute("aria-labelledby") ?? "";
      expect(document.getElementById(tabId)).not.toBeNull();
    });
  });
});

describe("Skip link", () => {
  it("exposes a skip-to-content affordance", async () => {
    await boot();
    await waitFor(() => {
      const link = screen.getByText(/skip to main content/i);
      expect(link).toBeTruthy();
      expect(link.getAttribute("href")).toBe("#main-content");
    });
  });
});

describe("Onboarding", () => {
  it("persists dismissal in localStorage after a Skip click", async () => {
    await boot();
    // boot() dismissed onboarding above; the key should now be set.
    expect(localStorage.getItem("designer:onboarding-done")).toBe("1");
  });
});

describe("Tab close", () => {
  it("removes a tab from the tabs bar when the close affordance is clicked", async () => {
    await boot();
    // Enter a workspace that has tabs.
    await waitFor(() => document.querySelector("button.workspace-row"));
    const row = document.querySelector<HTMLButtonElement>("button.workspace-row");
    fireEvent.click(row!);

    await waitFor(() => {
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0);
    });

    const initialCount = document.querySelectorAll('.tabs-bar [role="tab"]').length;
    const firstClose = document.querySelector<HTMLButtonElement>(
      "button.tab-button__close",
    );
    expect(firstClose).not.toBeNull();
    fireEvent.click(firstClose!);

    await waitFor(() => {
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBe(initialCount - 1);
    });
  });

  // Friction frc_019de6fc — the close-tab button + ⌘W both did nothing.
  // ⌘W only fired when focus was on the tab button itself; the user
  // expects a global keystroke to close the active tab regardless of
  // where focus is.
  it("⌘W closes the active tab when focus is in the composer", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );
    // Open a second tab so closing one leaves a non-empty bar (and
    // ⌘W has an unambiguous active tab to act on).
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const before = document.querySelectorAll('.tabs-bar [role="tab"]').length;
    expect(before).toBeGreaterThanOrEqual(2);

    // Move focus into the composer textarea — this is the case the
    // friction report described (typing, then hitting ⌘W).
    await waitFor(() =>
      expect(document.querySelector("textarea.compose__input")).not.toBeNull(),
    );
    document.querySelector<HTMLTextAreaElement>("textarea.compose__input")!
      .focus();

    fireEvent.keyDown(window, { key: "w", metaKey: true });

    await waitFor(() => {
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBe(before - 1);
    });
  });
});

// Friction frc_019de6fd — switching tabs flashed an empty-state
// suggestion strip before settling on the destination tab's content.
// Once a tab has been "started" (a message was sent), switching back
// must paint the thread synchronously on the first frame.
describe("Tab switch does not flash empty state (frc_019de6fd)", () => {
  it("a started tab paints the thread on the first render of a remount", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );

    // Make sure two tabs exist — we'll switch between them.
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    // Mark the currently active tab as "started" by sending a
    // message. The send flips the per-tab `tabStartedById` flag in the
    // app store so the suggestion strip never reappears on remount.
    const composer = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    );
    expect(composer).not.toBeNull();
    fireEvent.change(composer!, { target: { value: "hi" } });
    fireEvent.keyDown(composer!, { key: "Enter", metaKey: true });
    await waitFor(() => {
      // After send the suggestion list is gone — thread mode is on.
      expect(document.querySelector(".thread--suggestions")).toBeNull();
    });

    // Switch to the other tab, then back. The destination tab must
    // not flash the suggestion-list empty state — we assert there is
    // no suggestion list synchronously after the switch.
    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]'),
    );
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    const activeIdx = tabs.findIndex(
      (t) => t.getAttribute("data-active") === "true",
    );
    const otherIdx = activeIdx === 0 ? 1 : 0;
    fireEvent.click(tabs[otherIdx]);
    fireEvent.click(tabs[activeIdx]);
    // First frame after the switch back: the thread must already be
    // mounted, not the suggestion strip.
    expect(document.querySelector(".thread--suggestions")).toBeNull();
  });
});

// Friction frc_019de703 — typing in tab A, switching to tab B, and
// switching back lost the in-progress draft. The composer state must
// be persisted per-tab in the app store.
describe("Composer drafts persist across tab switches (frc_019de703)", () => {
  it("preserves the textarea content when leaving and returning to a tab", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]'),
    );
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    const activeIdx = tabs.findIndex(
      (t) => t.getAttribute("data-active") === "true",
    );
    const otherIdx = activeIdx === 0 ? 1 : 0;

    // Type a distinctive draft into tab A.
    const composer = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    );
    expect(composer).not.toBeNull();
    fireEvent.change(composer!, { target: { value: "draft for tab A" } });
    expect(composer!.value).toBe("draft for tab A");

    // Switch to tab B. The composer textarea is part of the
    // WorkspaceThread surface that now stays mounted across tab
    // switches (Phase 23.D), so the textarea node persists; the
    // assertion of interest is the round-trip through B and back to
    // A — that's where the friction happened.
    fireEvent.click(tabs[otherIdx]);
    await waitFor(() => {
      expect(
        document.querySelector<HTMLTextAreaElement>("textarea.compose__input"),
      ).not.toBeNull();
    });

    // Switch back to tab A. The draft should be restored.
    fireEvent.click(tabs[activeIdx]);
    await waitFor(() => {
      const t = document.querySelector<HTMLTextAreaElement>(
        "textarea.compose__input",
      );
      expect(t).not.toBeNull();
      expect(t!.value).toBe("draft for tab A");
    });
  });
});

// T1 — burst clicks on the + button must not produce duplicate tabs.
// Regression for B1 (`MainView.onOpenTab` had no synchronous re-entry
// guard; two clicks within the same microtask both fired
// `ipcClient.openTab`).
describe("Tab open re-entry guard (B1)", () => {
  let realOpenTab: IpcClient["openTab"] | null = null;

  afterEach(() => {
    // Restore the real openTab on the live client (we monkey-patched
    // because the client's methods live on a class prototype and a
    // simple object-spread loses them).
    if (realOpenTab) {
      (ipcClient() as { openTab: IpcClient["openTab"] }).openTab = realOpenTab;
      realOpenTab = null;
    }
  });

  it("calls ipcClient.openTab exactly once when the + button is clicked twice synchronously", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );

    // Patch openTab on the live client to defer until we explicitly
    // resolve. A real double-click sees the same race in production:
    // the second click lands while the first IPC call is still
    // awaiting.
    const live = ipcClient();
    realOpenTab = live.openTab.bind(live);
    let resolveOpen!: () => void;
    const openTabSpy = vi.fn(
      (req: Parameters<IpcClient["openTab"]>[0]) =>
        new Promise<Awaited<ReturnType<IpcClient["openTab"]>>>((r) => {
          resolveOpen = () => {
            void realOpenTab!(req).then(r);
          };
        }),
    );
    (live as { openTab: IpcClient["openTab"] }).openTab = openTabSpy;

    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    expect(plusBtn).not.toBeNull();

    fireEvent.click(plusBtn!);
    fireEvent.click(plusBtn!);

    // Synchronously after both clicks, the spy should have been invoked
    // at most once — the ref guard short-circuits the second click
    // before reaching the IPC call.
    expect(openTabSpy.mock.calls.length).toBeLessThanOrEqual(1);

    // Settle the in-flight call so refresh + selectTab can complete and
    // the test cleanup doesn't leak a pending promise.
    resolveOpen();
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    expect(openTabSpy).toHaveBeenCalledTimes(1);
  });
});

// T15 — closing a middle tab and opening a new one must not produce a
// duplicate underlying title. Regression for B10 (the index used to
// derive new-tab titles came from `visibleTabs.length + 1`, which
// reused indices after closes).
describe("Tab title indices don't collide (B10)", () => {
  it("never produces two tabs with the same title after close+reopen", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );

    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    expect(plusBtn).not.toBeNull();

    // Open a couple of tabs to grow the bar.
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    // Close the middle tab.
    const closeButtons = document.querySelectorAll<HTMLButtonElement>(
      "button.tab-button__close",
    );
    if (closeButtons.length > 1) {
      fireEvent.click(closeButtons[1]);
    }

    // Open another. Title should be the next monotonic index, not a
    // collision with whichever title the closed tab had.
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const titles = Array.from(
      document.querySelectorAll<HTMLElement>(
        '.tabs-bar [role="tab"] .tab-button__label',
      ),
    ).map((el) => el.textContent ?? "");
    const unique = new Set(titles);
    expect(unique.size).toBe(titles.length);
  });
});

// T16 — global ⌘T opens a new tab when focus is outside any text input.
// Regression for B9 (the tooltip on the + button advertised ⌘T but no
// global keyboard handler ever wired it).
describe("⌘T global shortcut (B9)", () => {
  it("opens a new tab on ⌘T when focus is in the document body", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );
    const before = document.querySelectorAll('.tabs-bar [role="tab"]').length;

    fireEvent.keyDown(window, { key: "t", metaKey: true });

    await waitFor(() => {
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBe(before + 1);
    });
  });

  it("does not fire when focus is in a textarea", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(document.querySelector("textarea.compose__input")).not.toBeNull(),
    );
    const textarea = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    );
    textarea!.focus();
    const before = document.querySelectorAll('.tabs-bar [role="tab"]').length;

    fireEvent.keyDown(textarea!, { key: "t", metaKey: true });

    // No new tab — handler defers to native input.
    expect(
      document.querySelectorAll('.tabs-bar [role="tab"]').length,
    ).toBe(before);
  });
});

// T2 — the active tab must carry a markup-level distinction from
// inactive ones, and the source CSS must wire that distinction to a
// font-weight delta + an active-only fill. Visual regression coverage
// lives in the Playwright suite (T22); this test guards the wiring.
describe("Tab visual contrast wiring (B2)", () => {
  it("CSS source declares an active-only font-weight and background fill", async () => {
    // Read the canonical tabs stylesheet and assert the active rule
    // sets BOTH font-weight and background. A future "harmonize" pass
    // that accidentally removes either lever flips this red so the
    // visual cue can't silently regress to washed-out parity.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const css = fs.readFileSync(
      path.resolve(__dirname, "..", "styles", "tabs.css"),
      "utf8",
    );
    const activeRule = css.match(
      /\.tab-button\[data-active="true"\][\s\S]*?\}/,
    );
    expect(activeRule, "expected an active-tab CSS block").toBeTruthy();
    expect(activeRule![0]).toMatch(/font-weight:\s*var\(--weight-/);
    expect(activeRule![0]).toMatch(/background:/);
  });

  it("emits data-active and aria-selected on the active tab and not on others", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );

    // Open another tab so we have at least two and can guarantee one
    // active + one inactive in the same DOM at the same time.
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]'),
    );
    expect(tabs.length).toBeGreaterThanOrEqual(2);

    const actives = tabs.filter(
      (t) => t.getAttribute("data-active") === "true",
    );
    const inactives = tabs.filter(
      (t) => t.getAttribute("data-active") !== "true",
    );
    expect(actives.length).toBe(1);
    expect(inactives.length).toBeGreaterThanOrEqual(1);

    expect(actives[0].getAttribute("aria-selected")).toBe("true");
    for (const i of inactives) {
      expect(i.getAttribute("aria-selected")).toBe("false");
    }
  });
});

// T17 — closing a tab must move focus somewhere sensible. Without
// this, focus falls back to <body> and keyboard users lose their
// place. B11.
describe("Tab close focus management (B11)", () => {
  it("moves focus to the next tab after closing the active tab", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );
    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );

    // Make sure there are at least two tabs, then close the active one.
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const initialTabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]'),
    );
    expect(initialTabs.length).toBeGreaterThanOrEqual(2);
    const activeBefore = initialTabs.find(
      (t) => t.getAttribute("data-active") === "true",
    );
    const closeBtn = activeBefore!.parentElement!.querySelector<HTMLButtonElement>(
      "button.tab-button__close",
    );
    expect(closeBtn).not.toBeNull();
    fireEvent.click(closeBtn!);

    await waitFor(() => {
      const tabs = document.querySelectorAll<HTMLButtonElement>(
        '.tabs-bar [role="tab"]',
      );
      expect(tabs.length).toBe(initialTabs.length - 1);
    });

    // Focus landed on a button (not body). Either the next tab or
    // the new-tab affordance is acceptable per the WAI Tabs pattern.
    await waitFor(() => {
      const focused = document.activeElement;
      expect(focused).not.toBe(document.body);
      expect(
        focused?.getAttribute("role") === "tab" ||
          focused?.getAttribute("aria-label") === "New tab",
      ).toBe(true);
    });
  });
});

// T3 — project home (no workspace selected) must never render any tab
// roles. Regression for B3 (vertical column of "Tab N" rows leaking
// into the project home view).
describe("Project home renders no tab roles (B3)", () => {
  it("has zero [role=tab] elements anywhere in the document when on home", async () => {
    await boot();
    // Start by selecting a workspace, opening tabs, then bouncing
    // back to home — exercising any lingering / stale state path.
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );
    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );

    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const home = document.querySelector<HTMLButtonElement>(".sidebar-home");
    expect(home).not.toBeNull();
    fireEvent.click(home!);

    await waitFor(() => {
      const region = document.getElementById("project-home");
      expect(region).not.toBeNull();
    });
    expect(document.querySelectorAll('[role="tab"]').length).toBe(0);
    expect(document.querySelectorAll(".tabs-bar").length).toBe(0);
  });
});

// Phase 23.D — tab switches must NOT remount WorkspaceThread. The artifact
// stream listener, in-flight payload fetches, and any internal scroll /
// expanded state get torn down on remount; on return the user sees a
// freshly fetched but otherwise empty surface — anything that landed live
// while they were away was missed. The fix drops `activeTab` from the
// React key in MainView so the component instance survives across tab
// switches; refresh on tab change is already wired via the
// `[workspace.id, tabId]` dep on the refresh callback.
describe("Phase 23.D — WorkspaceThread persists across tab switches", () => {
  // T-23D-1 — component identity. Render with tab A active, switch to B,
  // switch back to A; assert the same DOM node carrying
  // `data-component="WorkspaceThread"` survived. With the old key
  // (`workspace.id:activeTab`) every switch produced a new node; with the
  // new key only a workspace change does.
  it("T-23D-1: the WorkspaceThread DOM node persists across tab switches", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );

    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );
    // Open a second tab so we can switch.
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const initialThread = document.querySelector(
      '[data-component="WorkspaceThread"]',
    );
    expect(initialThread).not.toBeNull();

    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]'),
    );
    expect(tabs.length).toBeGreaterThanOrEqual(2);
    const activeIdx = tabs.findIndex(
      (t) => t.getAttribute("data-active") === "true",
    );
    const otherIdx = activeIdx === 0 ? 1 : 0;

    fireEvent.click(tabs[otherIdx]);
    await waitFor(() => {
      expect(tabs[otherIdx].getAttribute("data-active")).toBe("true");
    });
    const afterSwitch = document.querySelector(
      '[data-component="WorkspaceThread"]',
    );
    // Same DOM node — React kept the instance.
    expect(afterSwitch).toBe(initialThread);

    fireEvent.click(tabs[activeIdx]);
    await waitFor(() => {
      expect(tabs[activeIdx].getAttribute("data-active")).toBe("true");
    });
    const afterReturn = document.querySelector(
      '[data-component="WorkspaceThread"]',
    );
    expect(afterReturn).toBe(initialThread);
  });

  // T-23D-2 — listener survives. While the user is on tab B, an
  // artifact-stream event for the workspace lands. The listener (which
  // lives in WorkspaceThread) must still be subscribed and must trigger
  // a refresh — proof that the component wasn't torn down on the switch.
  // We patch `ipcClient().stream` to capture the live handler so we can
  // dispatch a synthetic `artifact_created` and observe the refetch.
  it("T-23D-2: the artifact-stream listener still fires after a tab switch", async () => {
    await boot();
    const live = ipcClient();
    // Capture the latest registered stream handler.
    const origStream = live.stream.bind(live);
    let capturedHandler: ((e: StreamEvent) => void) | null = null;
    type StreamArg = Parameters<IpcClient["stream"]>[0];
    (live as { stream: IpcClient["stream"] }).stream = (h: StreamArg) => {
      capturedHandler = h;
      return origStream(h);
    };

    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );
    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );

    // Spy on the per-tab artifact list fetch — that's what a refresh
    // round-trip ultimately calls.
    const origList = live.listArtifactsInTab.bind(live);
    const listSpy = vi.fn(origList);
    (live as { listArtifactsInTab: IpcClient["listArtifactsInTab"] })
      .listArtifactsInTab = listSpy;

    // Open a second tab so the user can switch off the original.
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]'),
    );
    const activeIdx = tabs.findIndex(
      (t) => t.getAttribute("data-active") === "true",
    );
    const otherIdx = activeIdx === 0 ? 1 : 0;

    // Switch to tab B and let the resulting refresh settle.
    fireEvent.click(tabs[otherIdx]);
    await waitFor(() => {
      expect(tabs[otherIdx].getAttribute("data-active")).toBe("true");
    });
    expect(capturedHandler).not.toBeNull();

    // Read the active workspace id off the DOM (cheaper than poking the
    // store), then dispatch a synthetic artifact-stream event scoped to
    // it — exactly the shape `core_agents` emits in production.
    const workspaceId = appStore.get().activeWorkspace as string;
    expect(workspaceId).toBeTruthy();

    listSpy.mockClear();
    await act(async () => {
      capturedHandler!({
        kind: "artifact_created",
        stream_id: `workspace:${workspaceId}`,
        sequence: 9999,
        timestamp: "2026-05-02T00:00:00Z",
      });
      // The listener coalesces on requestAnimationFrame; flush a frame.
      await new Promise<void>((r) =>
        window.requestAnimationFrame(() => r()),
      );
    });

    await waitFor(() => {
      expect(listSpy).toHaveBeenCalled();
    });
  });

  // T-23D-3 — scroll position preserved per tab. With WorkspaceThread
  // staying mounted, the `.thread` log element keeps its scrollTop across
  // a tab switch (no remount = no fresh element clamped to scrollTop=0).
  // jsdom doesn't lay anything out, so we install a small scrollHeight /
  // clientHeight shim — same pattern `chat-scroll.test.tsx` uses.
  it("T-23D-3: scrollTop on the thread log is preserved across a tab switch", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );
    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );

    // Send a message so `hasStarted` flips and the `.thread` log mounts.
    const composer = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    );
    expect(composer).not.toBeNull();
    fireEvent.change(composer!, { target: { value: "hello" } });
    fireEvent.keyDown(composer!, { key: "Enter", metaKey: true });
    const thread = await waitFor(() => {
      const t = document.querySelector<HTMLElement>(".thread");
      expect(t).not.toBeNull();
      return t!;
    });

    // Open a second tab to switch off to.
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    // Pretend the thread has more content than fits, then scroll up so
    // stickiness flips off (otherwise the layout effect would re-pin to
    // the bottom on every artifact-length change).
    Object.defineProperty(thread, "scrollHeight", {
      configurable: true,
      get: () => 1000,
    });
    Object.defineProperty(thread, "clientHeight", {
      configurable: true,
      get: () => 400,
    });
    thread.scrollTop = 120;
    fireEvent.scroll(thread);

    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]'),
    );
    const activeIdx = tabs.findIndex(
      (t) => t.getAttribute("data-active") === "true",
    );
    const otherIdx = activeIdx === 0 ? 1 : 0;

    // Switch to B, then back to A.
    fireEvent.click(tabs[otherIdx]);
    await waitFor(() => {
      expect(tabs[otherIdx].getAttribute("data-active")).toBe("true");
    });
    fireEvent.click(tabs[activeIdx]);
    await waitFor(() => {
      expect(tabs[activeIdx].getAttribute("data-active")).toBe("true");
    });

    // Same node, scrollTop preserved.
    const after = document.querySelector<HTMLElement>(".thread");
    expect(after).toBe(thread);
    expect(thread.scrollTop).toBe(120);
  });

  // T-23D-4 — composer draft preserved across the round-trip A → B → A.
  // The `Composer drafts persist across tab switches` describe above
  // already exercises this; we re-assert here so a future regression
  // attributes to the right phase test.
  it("T-23D-4: the textarea draft is restored when returning to the original tab", async () => {
    await boot();
    await waitFor(() => document.querySelector("button.workspace-row"));
    fireEvent.click(
      document.querySelector<HTMLButtonElement>("button.workspace-row")!,
    );
    await waitFor(() =>
      expect(
        document.querySelectorAll('.tabs-bar [role="tab"]').length,
      ).toBeGreaterThan(0),
    );
    const plusBtn = document.querySelector<HTMLButtonElement>(
      ".new-tab button[aria-label='New tab']",
    );
    fireEvent.click(plusBtn!);
    await waitFor(() => {
      expect(plusBtn!.getAttribute("aria-busy")).not.toBe("true");
    });

    const tabs = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.tabs-bar [role="tab"]'),
    );
    const activeIdx = tabs.findIndex(
      (t) => t.getAttribute("data-active") === "true",
    );
    const otherIdx = activeIdx === 0 ? 1 : 0;

    const composer = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    );
    expect(composer).not.toBeNull();
    fireEvent.change(composer!, { target: { value: "hello" } });

    fireEvent.click(tabs[otherIdx]);
    await waitFor(() => {
      expect(tabs[otherIdx].getAttribute("data-active")).toBe("true");
    });
    fireEvent.click(tabs[activeIdx]);
    await waitFor(() => {
      expect(tabs[activeIdx].getAttribute("data-active")).toBe("true");
    });

    const t = document.querySelector<HTMLTextAreaElement>(
      "textarea.compose__input",
    );
    expect(t).not.toBeNull();
    expect(t!.value).toBe("hello");
  });
});
