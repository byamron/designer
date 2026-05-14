import { describe, expect, it } from "vitest";
import {
  deriveTitle,
  isDefaultTabName,
  isDefaultWorkspaceName,
  planAutoName,
} from "../util/autoname";

describe("deriveTitle (frc_019dea6a-9278)", () => {
  it("takes the first five words and sentence-cases", () => {
    expect(deriveTitle("what are we building today next")).toBe(
      "What are we building today",
    );
  });

  it("caps the result at 30 chars on word boundary", () => {
    const out = deriveTitle("supercalifragilisticexpialidocious is a long word");
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(30);
  });

  it("strips leading punctuation and whitespace", () => {
    expect(deriveTitle("  ??? help me debug this")).toBe("Help me debug this");
  });

  it("returns null for whitespace-only input", () => {
    expect(deriveTitle("   \n\t  ")).toBeNull();
  });

  it("returns null for emoji-only input", () => {
    expect(deriveTitle("🎉🚀")).toBeNull();
  });

  it("returns null for punctuation-only input", () => {
    expect(deriveTitle("???!!!...")).toBeNull();
  });

  it("preserves casing of subsequent words", () => {
    expect(deriveTitle("review my React component")).toBe(
      "Review my React component",
    );
  });
});

describe("planAutoName", () => {
  it("renames both workspace and tab when both still have defaults", () => {
    const plan = planAutoName({
      workspaceName: "Workspace 1",
      tabTitle: "Tab 1",
      text: "Help me debug this auth flow",
    });
    expect(plan).toEqual({
      title: "Help me debug this auth",
      renameWorkspace: true,
      renameTab: true,
    });
  });

  it("renames only the tab when the workspace has been customized", () => {
    const plan = planAutoName({
      workspaceName: "Auth refactor",
      tabTitle: "Tab 1",
      text: "Help me debug this auth flow",
    });
    expect(plan?.renameWorkspace).toBe(false);
    expect(plan?.renameTab).toBe(true);
  });

  it("renames only the workspace when the tab has been customized", () => {
    const plan = planAutoName({
      workspaceName: "Workspace 1",
      tabTitle: "Plan",
      text: "Help me debug this auth flow",
    });
    expect(plan?.renameWorkspace).toBe(true);
    expect(plan?.renameTab).toBe(false);
  });

  it("returns null when nothing needs renaming", () => {
    expect(
      planAutoName({
        workspaceName: "Auth refactor",
        tabTitle: "Plan",
        text: "Help me debug this auth flow",
      }),
    ).toBeNull();
  });

  it("returns null when the message yields no usable title", () => {
    expect(
      planAutoName({
        workspaceName: "Workspace 1",
        tabTitle: "Tab 1",
        text: "🎉",
      }),
    ).toBeNull();
  });

  it("handles missing tab title (workspace-only rename)", () => {
    const plan = planAutoName({
      workspaceName: "Workspace 1",
      tabTitle: null,
      text: "Help me debug",
    });
    expect(plan?.renameWorkspace).toBe(true);
    expect(plan?.renameTab).toBe(false);
  });
});

describe("default-name detectors", () => {
  it("matches Workspace N", () => {
    expect(isDefaultWorkspaceName("Workspace 1")).toBe(true);
    expect(isDefaultWorkspaceName("Workspace 42")).toBe(true);
    expect(isDefaultWorkspaceName("Workspace")).toBe(false);
    expect(isDefaultWorkspaceName("My Workspace 1")).toBe(false);
    expect(isDefaultWorkspaceName("workspace 1")).toBe(false);
  });

  it("matches Tab N", () => {
    expect(isDefaultTabName("Tab 1")).toBe(true);
    expect(isDefaultTabName("Tab 99")).toBe(true);
    expect(isDefaultTabName("Tab")).toBe(false);
    expect(isDefaultTabName("Tab Plan")).toBe(false);
    expect(isDefaultTabName("tab 1")).toBe(false);
  });
});
