// App-level state: current project, current workspace, open tab per workspace.
import { createStore, useStore } from "./index";
import type { ProjectId, TabId, WorkspaceId } from "../ipc/types";

export interface AppState {
  activeProject: ProjectId | null;
  activeWorkspace: WorkspaceId | null;
  activeTabByWorkspace: Record<WorkspaceId, TabId | "home">;
  quickSwitcherOpen: boolean;
  followingAgent: string | null;
  inboxOpen: boolean;
}

export const appStore = createStore<AppState>({
  activeProject: null,
  activeWorkspace: null,
  activeTabByWorkspace: {},
  quickSwitcherOpen: false,
  followingAgent: null,
  inboxOpen: false,
});

export const useAppState = <U,>(selector: (s: AppState) => U) =>
  useStore(appStore, selector);

// Actions ------------------------------------------------------------------

export const selectProject = (id: ProjectId | null) =>
  appStore.set((s) => ({ ...s, activeProject: id, activeWorkspace: null }));

export const selectWorkspace = (id: WorkspaceId | null) =>
  appStore.set((s) => ({ ...s, activeWorkspace: id }));

export const selectTab = (workspaceId: WorkspaceId, tabId: TabId | "home") =>
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
