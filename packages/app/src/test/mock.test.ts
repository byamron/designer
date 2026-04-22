import { describe, expect, it } from "vitest";
import { createMockCore } from "../ipc/mock";

describe("MockCore", () => {
  it("seeds with recognizable projects and workspaces", () => {
    const core = createMockCore();
    const projects = core.listProjects();
    expect(projects.length).toBeGreaterThanOrEqual(2);
    const designer = projects.find((p) => p.project.name === "Designer");
    expect(designer).toBeDefined();
    expect(core.listWorkspaces(designer!.project.id).length).toBeGreaterThan(0);
  });

  it("emits events on create and delivers to subscribers", () => {
    const core = createMockCore();
    const events: string[] = [];
    const off = core.subscribe((e) => events.push(e.kind));
    const [first] = core.listProjects();
    core.createWorkspace({
      project_id: first.project.id,
      name: "sample",
      base_branch: "main",
    });
    off();
    expect(events).toContain("workspace_created");
  });

  it("approval flow records two events and marks status", () => {
    const core = createMockCore();
    const [first] = core.listProjects();
    const ws = core.listWorkspaces(first.project.id)[0].workspace.id;
    const kinds: string[] = [];
    core.subscribe((e) => kinds.push(e.kind));
    const id = core.requestApproval(ws, "merge", "merge PR");
    core.resolveApproval(id, true);
    expect(kinds).toContain("approval_requested");
    expect(kinds).toContain("approval_granted");
    const approval = core.approvals().find((a) => a.id === id);
    expect(approval?.status).toBe("granted");
  });

  it("spine root lists projects at the project altitude", () => {
    const core = createMockCore();
    const rows = core.spine(null);
    expect(rows.length).toBeGreaterThanOrEqual(1);
    for (const r of rows) expect(r.altitude).toBe("project");
  });
});
