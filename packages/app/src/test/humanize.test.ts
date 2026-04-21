import { describe, expect, it } from "vitest";
import { humanizeKind } from "../util/humanize";

describe("humanizeKind", () => {
  it("maps known event kinds to manager-friendly labels", () => {
    expect(humanizeKind("project_created")).toBe("Project created");
    expect(humanizeKind("approval_requested")).toBe("Approval requested");
    expect(humanizeKind("agent_spawned")).toBe("Agent joined");
  });

  it("falls back to title case for unknown kinds", () => {
    expect(humanizeKind("some_new_thing")).toBe("Some New Thing");
  });
});
