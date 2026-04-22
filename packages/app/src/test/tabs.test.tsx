import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";
import { appStore, setDashboardVariant } from "../store/app";

beforeEach(() => {
  // Start each test with a clean localStorage so onboarding shows predictably.
  localStorage.clear();
  // The app store is a module singleton; reset transient selection + variant
  // state so tests don't leak through it.
  appStore.set((s) => ({
    ...s,
    activeProject: null,
    activeWorkspace: null,
    activeTabByWorkspace: {},
  }));
  setDashboardVariant("A");
  localStorage.clear();
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
  it("renders the project name as h1 in the topbar on boot", async () => {
    await boot();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "Designer" })).toBeTruthy();
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

describe("Home variant toggle", () => {
  it("switches between Panels (A) and Palette (B) and persists the choice", async () => {
    await boot();
    // Start on Panels (default).
    await waitFor(() => {
      expect(document.querySelector(".home-a")).not.toBeNull();
    });

    const palette = screen.getByRole("button", { name: /palette/i });
    fireEvent.click(palette);
    await waitFor(() => {
      expect(document.querySelector(".home-b")).not.toBeNull();
    });
    expect(localStorage.getItem("designer.dashboardVariant")).toBe("B");

    const panels = screen.getByRole("button", { name: /^panels/i });
    fireEvent.click(panels);
    await waitFor(() => {
      expect(document.querySelector(".home-a")).not.toBeNull();
    });
    expect(localStorage.getItem("designer.dashboardVariant")).toBe("A");
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
});
