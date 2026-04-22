// App-level state: current project, current workspace, open tab per workspace.
import { createStore, useStore } from "./index";
import type { ProjectId, TabId, WorkspaceId } from "../ipc/types";

export type DashboardVariant = "A" | "B";

const DASHBOARD_VARIANT_STORAGE_KEY = "designer.dashboardVariant";

function readStoredVariant(): DashboardVariant {
  if (typeof window === "undefined") return "A";
  const stored = window.localStorage.getItem(DASHBOARD_VARIANT_STORAGE_KEY);
  return stored === "B" ? "B" : "A";
}

export interface AppState {
  activeProject: ProjectId | null;
  activeWorkspace: WorkspaceId | null;
  activeTabByWorkspace: Record<WorkspaceId, TabId>;
  quickSwitcherOpen: boolean;
  followingAgent: string | null;
  inboxOpen: boolean;
  dashboardVariant: DashboardVariant;
  projectStripVisible: boolean;
}

export const appStore = createStore<AppState>({
  activeProject: null,
  activeWorkspace: null,
  activeTabByWorkspace: {},
  quickSwitcherOpen: false,
  followingAgent: null,
  inboxOpen: false,
  dashboardVariant: readStoredVariant(),
  projectStripVisible: true,
});

export const useAppState = <U,>(selector: (s: AppState) => U) =>
  useStore(appStore, selector);

// Actions ------------------------------------------------------------------

export const selectProject = (id: ProjectId | null) =>
  appStore.set((s) => ({ ...s, activeProject: id, activeWorkspace: null }));

export const selectWorkspace = (id: WorkspaceId | null) =>
  appStore.set((s) => ({ ...s, activeWorkspace: id }));

export const selectTab = (workspaceId: WorkspaceId, tabId: TabId) =>
  appStore.set((s) => ({
    ...s,
    activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceId]: tabId },
  }));

export const toggleQuickSwitcher = (open?: boolean) =>
  appStore.set((s) => ({
    ...s,
    quickSwitcherOpen: open ?? !s.quickSwitcherOpen,
  }));

export const setFollowingAgent = (id: string | null) =>
  appStore.set((s) => ({ ...s, followingAgent: id }));

export const toggleInbox = (open?: boolean) =>
  appStore.set((s) => ({ ...s, inboxOpen: open ?? !s.inboxOpen }));

export const setDashboardVariant = (variant: DashboardVariant) => {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(DASHBOARD_VARIANT_STORAGE_KEY, variant);
  }
  appStore.set((s) => ({ ...s, dashboardVariant: variant }));
};

export const cycleDashboardVariant = () =>
  setDashboardVariant(appStore.get().dashboardVariant === "A" ? "B" : "A");

export const toggleProjectStrip = (visible?: boolean) =>
  appStore.set((s) => ({
    ...s,
    projectStripVisible: visible ?? !s.projectStripVisible,
  }));
