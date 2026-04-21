import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { App } from "../App";

beforeEach(() => {
  // Start each test with a clean localStorage so onboarding shows predictably.
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

describe("Tab primitive", () => {
  it("renders a home tab with h1 workspace name in the topbar", async () => {
    await boot();
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1, name: "onboarding" })).toBeTruthy();
    });
  });

  it("has role=tabpanel wired to the active tab", async () => {
    await boot();
    await waitFor(() => {
      const panel = document.getElementById("tabpanel-home");
      expect(panel).not.toBeNull();
      expect(panel?.getAttribute("role")).toBe("tabpanel");
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
