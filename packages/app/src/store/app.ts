// App-level state: current project, current workspace, open tab per workspace.
import { createStore, useStore } from "./index";
import type { ProjectId, TabId, WorkspaceId } from "../ipc/types";
import {
  persisted,
  stringDecoder,
  booleanDecoder,
  intDecoder,
} from "../util/persisted";

export type DashboardVariant = "A" | "B";
export type PaletteDensity = "bounded" | "open";
export type AppDialog = "settings" | "help" | null;

export const PANE_MIN_WIDTH = 180;
export const PANE_MAX_WIDTH = 480;
export const PANE_DEFAULT_WIDTH = 256;

export function clampPaneWidth(width: number): number {
  if (width < PANE_MIN_WIDTH) return PANE_MIN_WIDTH;
  if (width > PANE_MAX_WIDTH) return PANE_MAX_WIDTH;
  return Math.round(width);
}

const variantStore = persisted<DashboardVariant>(
  "designer.dashboardVariant",
  "A",
  stringDecoder(["A", "B"] as const),
);

const densityStore = persisted<PaletteDensity>(
  "designer.paletteDensity",
  "bounded",
  stringDecoder(["bounded", "open"] as const),
);

const sidebarVisibleStore = persisted<boolean>(
  "designer.sidebarVisible",
  true,
  booleanDecoder,
);

const spineVisibleStore = persisted<boolean>(
  "designer.spineVisible",
  true,
  booleanDecoder,
);

const sidebarWidthStore = persisted<number>(
  "designer.sidebarWidth",
  PANE_DEFAULT_WIDTH,
  intDecoder(clampPaneWidth),
);

const spineWidthStore = persisted<number>(
  "designer.spineWidth",
  PANE_DEFAULT_WIDTH,
  intDecoder(clampPaneWidth),
);

export interface AppState {
  activeProject: ProjectId | null;
  activeWorkspace: WorkspaceId | null;
  activeTabByWorkspace: Record<WorkspaceId, TabId>;
  quickSwitcherOpen: boolean;
  followingAgent: string | null;
  inboxOpen: boolean;
  dashboardVariant: DashboardVariant;
  paletteDensity: PaletteDensity;
  projectStripVisible: boolean;
  sidebarVisible: boolean;
  spineVisible: boolean;
  sidebarWidth: number;
  spineWidth: number;
  dialog: AppDialog;
}

export const appStore = createStore<AppState>({
  activeProject: null,
  activeWorkspace: null,
  activeTabByWorkspace: {},
  quickSwitcherOpen: false,
  followingAgent: null,
  inboxOpen: false,
  dashboardVariant: variantStore.read(),
  paletteDensity: densityStore.read(),
  projectStripVisible: true,
  sidebarVisible: sidebarVisibleStore.read(),
  spineVisible: spineVisibleStore.read(),
  sidebarWidth: sidebarWidthStore.read(),
  spineWidth: spineWidthStore.read(),
  dialog: null,
});

export const useAppState = <U,>(selector: (s: AppState) => U) =>
  useStore(appStore, selector);

// Actions ------------------------------------------------------------------

export const selectProject = (id: ProjectId | null) =>
  appStore.set((s) =>
    s.activeProject === id && s.activeWorkspace === null
      ? s
      : { ...s, activeProject: id, activeWorkspace: null },
  );

export const selectWorkspace = (id: WorkspaceId | null) =>
  appStore.set((s) => (s.activeWorkspace === id ? s : { ...s, activeWorkspace: id }));

export const selectTab = (workspaceId: WorkspaceId, tabId: TabId) =>
  appStore.set((s) =>
    s.activeTabByWorkspace[workspaceId] === tabId
      ? s
      : {
          ...s,
          activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceId]: tabId },
        },
  );

export const toggleQuickSwitcher = (open?: boolean) =>
  appStore.set((s) => {
    const next = open ?? !s.quickSwitcherOpen;
    return s.quickSwitcherOpen === next ? s : { ...s, quickSwitcherOpen: next };
  });

export const setFollowingAgent = (id: string | null) =>
  appStore.set((s) => (s.followingAgent === id ? s : { ...s, followingAgent: id }));

export const toggleInbox = (open?: boolean) =>
  appStore.set((s) => {
    const next = open ?? !s.inboxOpen;
    return s.inboxOpen === next ? s : { ...s, inboxOpen: next };
  });

export const setDashboardVariant = (variant: DashboardVariant) => {
  appStore.set((s) => {
    if (s.dashboardVariant === variant) return s;
    variantStore.write(variant);
    return { ...s, dashboardVariant: variant };
  });
};

export const cycleDashboardVariant = () =>
  setDashboardVariant(appStore.get().dashboardVariant === "A" ? "B" : "A");

export const toggleProjectStrip = (visible?: boolean) =>
  appStore.set((s) => {
    const next = visible ?? !s.projectStripVisible;
    return s.projectStripVisible === next ? s : { ...s, projectStripVisible: next };
  });

export const setPaletteDensity = (density: PaletteDensity) => {
  appStore.set((s) => {
    if (s.paletteDensity === density) return s;
    densityStore.write(density);
    return { ...s, paletteDensity: density };
  });
};

export const toggleSidebar = (visible?: boolean) => {
  appStore.set((s) => {
    const next = visible ?? !s.sidebarVisible;
    if (s.sidebarVisible === next) return s;
    sidebarVisibleStore.write(next);
    return { ...s, sidebarVisible: next };
  });
};

export const toggleSpine = (visible?: boolean) => {
  appStore.set((s) => {
    const next = visible ?? !s.spineVisible;
    if (s.spineVisible === next) return s;
    spineVisibleStore.write(next);
    return { ...s, spineVisible: next };
  });
};

/** Called during drag — updates in-memory width only, does not persist. */
export const setSidebarWidthLive = (width: number) => {
  const clamped = clampPaneWidth(width);
  appStore.set((s) => (s.sidebarWidth === clamped ? s : { ...s, sidebarWidth: clamped }));
};

/** Called on pointer-up — flushes the latest width to localStorage. */
export const commitSidebarWidth = () => {
  sidebarWidthStore.write(appStore.get().sidebarWidth);
};

export const setSpineWidthLive = (width: number) => {
  const clamped = clampPaneWidth(width);
  appStore.set((s) => (s.spineWidth === clamped ? s : { ...s, spineWidth: clamped }));
};

export const commitSpineWidth = () => {
  spineWidthStore.write(appStore.get().spineWidth);
};

export const openDialog = (dialog: AppDialog) =>
  appStore.set((s) => (s.dialog === dialog ? s : { ...s, dialog }));

export const closeDialog = () =>
  appStore.set((s) => (s.dialog === null ? s : { ...s, dialog: null }));
