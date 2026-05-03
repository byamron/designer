import { act, render, screen } from "@testing-library/react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { MainView } from "../layout/MainView";
import { appStore } from "../store/app";
import { dataStore } from "../store/data";
import type { ProjectSummary, WorkspaceSummary } from "../ipc/types";

/**
 * T-23B-4 — cross-tab activity badge: when a non-active tab has
 * activity in flight, the tab-strip button shows the small dot. The
 * active tab does NOT show the badge — the dock row above the
 * textarea already surfaces the same signal there.
 */

const PROJECT_ID = "proj-23b";
const WS_ID = "ws-23b";
const TAB_A = "tab-a";
const TAB_B = "tab-b";

const project = {
  id: PROJECT_ID,
  name: "Designer",
  root_path: "/tmp",
  created_at: "2026-05-03T00:00:00Z",
  archived_at: null,
  autonomy: "suggest" as const,
};
const workspace = {
  id: WS_ID,
  project_id: PROJECT_ID,
  name: "ws",
  state: "active" as const,
  base_branch: "main",
  worktree_path: null,
  created_at: "2026-05-03T00:00:00Z",
  tabs: [
    { id: TAB_A, title: "Tab 1", template: "thread" as const, created_at: "2026-05-03T00:00:00Z", closed_at: null },
    { id: TAB_B, title: "Tab 2", template: "thread" as const, created_at: "2026-05-03T00:00:00Z", closed_at: null },
  ],
};

beforeEach(() => {
  const projects: ProjectSummary[] = [{ project, workspace_count: 1 }];
  const workspaces: Record<string, WorkspaceSummary[]> = {
    [PROJECT_ID]: [{ workspace, state: "active", agent_count: 0 }],
  };
  dataStore.set({
    projects,
    workspaces,
    spines: {},
    events: [],
    recentActivityTs: {},
    activity: {},
    loaded: true,
  });
  appStore.set((s) => ({
    ...s,
    activeProject: PROJECT_ID,
    activeWorkspace: WS_ID,
    activeTabByWorkspace: { [WS_ID]: TAB_A },
  }));
});

afterEach(() => {
  dataStore.set({
    projects: [],
    workspaces: {},
    spines: {},
    events: [],
    recentActivityTs: {},
    activity: {},
    loaded: false,
  });
  appStore.set((s) => ({ ...s, activeProject: null, activeWorkspace: null }));
});

describe("Tab strip activity badge", () => {
  it("paints the badge on a non-active tab when activity is in flight", () => {
    act(() => {
      dataStore.set((s) => ({
        ...s,
        activity: {
          [`${WS_ID}:${TAB_B}`]: { state: "working", since_ms: Date.now() },
        },
      }));
    });
    render(<MainView />);
    const tabBButton = screen.getByRole("tab", { name: /Tab 2/i });
    const badge = tabBButton.querySelector(".tab-button__activity-badge");
    expect(badge).not.toBeNull();
    expect(badge?.getAttribute("data-state")).toBe("working");
  });

  it("does NOT paint the badge on the active tab", () => {
    act(() => {
      dataStore.set((s) => ({
        ...s,
        activity: {
          [`${WS_ID}:${TAB_A}`]: { state: "working", since_ms: Date.now() },
        },
      }));
    });
    render(<MainView />);
    const tabAButton = screen.getByRole("tab", { name: /Tab 1/i });
    expect(tabAButton.querySelector(".tab-button__activity-badge")).toBeNull();
  });

  it("uses warning color for AwaitingApproval", () => {
    act(() => {
      dataStore.set((s) => ({
        ...s,
        activity: {
          [`${WS_ID}:${TAB_B}`]: {
            state: "awaiting_approval",
            since_ms: Date.now(),
          },
        },
      }));
    });
    render(<MainView />);
    const tabBButton = screen.getByRole("tab", { name: /Tab 2/i });
    const badge = tabBButton.querySelector(".tab-button__activity-badge");
    expect(badge?.getAttribute("data-state")).toBe("awaiting_approval");
  });
});
