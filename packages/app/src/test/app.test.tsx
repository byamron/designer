import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { App } from "../App";

describe("App", () => {
  it("boots into the mock core and renders the first project's workspace", async () => {
    render(<App />);
    // Loading state first.
    expect(screen.getByRole("status")).toBeTruthy();
    // Then the shell appears with the seeded Designer project.
    await waitFor(() => {
      expect(screen.getByLabelText("Projects")).toBeTruthy();
    });
    // Project initials render on the strip.
    expect(
      screen.getByLabelText("Designer", { selector: "button.strip-icon" }),
    ).toBeTruthy();
  });
});
