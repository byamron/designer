import { describe, expect, it } from "vitest";
import { humanizeRole } from "../util/humanize";

// CC1 — backend role strings (snake_case identifiers) must be turned
// into cockpit-register names before the user sees them. The chat
// surface treats the agent as a named teammate; "team-lead" reads as
// "Team Lead", not as a process label.
describe("humanizeRole (CC1)", () => {
  it("maps known agent roles to display names", () => {
    expect(humanizeRole("team-lead")).toBe("Team Lead");
    expect(humanizeRole("team_lead")).toBe("Team Lead");
    expect(humanizeRole("planner")).toBe("Planner");
    expect(humanizeRole("rust-core")).toBe("Rust Core");
    expect(humanizeRole("git-ops")).toBe("Git Ops");
  });

  it("collapses user-shaped roles to 'You'", () => {
    expect(humanizeRole("user")).toBe("You");
    expect(humanizeRole("you")).toBe("You");
  });

  it("falls back to 'Designer' when role is null or empty", () => {
    expect(humanizeRole(null)).toBe("Designer");
    expect(humanizeRole(undefined)).toBe("Designer");
    expect(humanizeRole("")).toBe("Designer");
  });

  it("strips a trailing _agent / -agent qualifier", () => {
    expect(humanizeRole("team_lead_agent")).toBe("Team Lead");
    expect(humanizeRole("planner-agent")).toBe("Planner");
  });

  it("title-cases unknown roles instead of leaking snake_case", () => {
    expect(humanizeRole("custom_role")).toBe("Custom Role");
    expect(humanizeRole("research-bot")).toBe("Research Bot");
  });
});
