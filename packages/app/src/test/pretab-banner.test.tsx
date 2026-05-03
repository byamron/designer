import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { appStore } from "../store/app";
import { dataStore } from "../store/data";

/**
 * Per-tab tutorial banner. 23.E.f1 reframed this from a migration
 * notice (which lied to fresh-install users about "your existing
 * chats") into a universal one-time tutorial that lands when the
 * user has at least one workspace. Detection signal kept (any
 * project carries a workspace) — gates the banner away from the
 * empty Home where Onboarding owns the surface. Dismissal persists
 * in localStorage.
 *
 * Boot harness mirrors `tabs.test.tsx` — same mock IPC, same store
 * resets — so we exercise the live app shell, not a stubbed component.
 */

const STORAGE_KEY = "designer:phase-23e-banner-dismissed";
const ONBOARDING_KEY = "designer:onboarding-done";

beforeEach(() => {
  localStorage.clear();
  // Pre-dismiss onboarding — it overlays the banner and the dialog
  // role would intercept the screen.queryByRole calls below. The
  // banner is aria-live polite, not a dialog, so it isn't subject
  // to the same modal stacking.
  localStorage.setItem(ONBOARDING_KEY, "1");
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
}

describe("PreTabSessionBanner (per-tab tutorial)", () => {
  it("renders when at least one workspace exists and the flag is unset", async () => {
    await boot();
    // Mock IPC seeds projects + workspaces, so the banner condition
    // (`hasPriorWorkspaces`) is true on every boot of the test harness.
    await waitFor(() => {
      expect(
        document.querySelector('[data-component="PreTabSessionBanner"]'),
      ).not.toBeNull();
    });
    expect(
      screen.getByText(/each tab is its own conversation/i),
    ).toBeTruthy();
  });

  it("uses universal tutorial copy that doesn't claim 'existing chats' for fresh installs", async () => {
    // 23.E.f1 lock-in: the migration-era copy ("your existing chats
    // start fresh") was inaccurate for users who created their first
    // workspace post-23.E. The tutorial reframe drops that claim
    // entirely. Catch any regression that re-introduces it.
    await boot();
    await waitFor(() =>
      expect(
        document.querySelector('[data-component="PreTabSessionBanner"]'),
      ).not.toBeNull(),
    );
    const banner = document.querySelector(
      '[data-component="PreTabSessionBanner"]',
    );
    const text = banner?.textContent ?? "";
    expect(text.toLowerCase()).not.toContain("existing chats");
    expect(text.toLowerCase()).not.toContain("start fresh");
  });

  it("dismiss button persists the flag and removes the banner", async () => {
    await boot();
    const banner = await waitFor(() =>
      document.querySelector<HTMLElement>('[data-component="PreTabSessionBanner"]'),
    );
    expect(banner).not.toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /got it/i }));

    await waitFor(() => {
      expect(
        document.querySelector('[data-component="PreTabSessionBanner"]'),
      ).toBeNull();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("stays hidden on a remount once dismissal is persisted", async () => {
    localStorage.setItem(STORAGE_KEY, "true");
    await boot();
    // Even after the data finishes loading, the banner must not appear.
    await waitFor(() => {
      // boot() succeeded; data is loaded. Settle once more so any
      // pending state-flips would have applied.
      expect(screen.getByLabelText("Projects")).toBeTruthy();
    });
    expect(
      document.querySelector('[data-component="PreTabSessionBanner"]'),
    ).toBeNull();
  });

  it("Escape dismisses the banner and persists the flag", async () => {
    await boot();
    await waitFor(() =>
      expect(
        document.querySelector('[data-component="PreTabSessionBanner"]'),
      ).not.toBeNull(),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => {
      expect(
        document.querySelector('[data-component="PreTabSessionBanner"]'),
      ).toBeNull();
    });
    expect(localStorage.getItem(STORAGE_KEY)).toBe("true");
  });

  it("stays hidden when no workspaces exist (fresh install)", async () => {
    await boot();
    // Force the dataStore into a "fresh install" shape: zero projects
    // and zero workspaces. The banner's `hasPriorWorkspaces` selector
    // re-runs on every store change, so this should hide it
    // immediately.
    dataStore.set((s) => ({
      ...s,
      projects: [],
      workspaces: {},
    }));
    await waitFor(() => {
      expect(
        document.querySelector('[data-component="PreTabSessionBanner"]'),
      ).toBeNull();
    });
  });
});
