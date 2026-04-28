// App-level state: current project, current workspace, open tab per workspace.
import { createStore, useStore } from "./index";
import { dataStore } from "./data";
import type { Autonomy, ProjectId, TabId, WorkspaceId } from "../ipc/types";
import type { Anchor } from "../lib/anchor";
import {
  persisted,
  stringDecoder,
  booleanDecoder,
  intDecoder,
} from "../util/persisted";

export type PaletteDensity = "bounded" | "open";
export type AppDialog = "settings" | "help" | "create-project" | null;

// Track 13.M — Friction trivial-by-default UX. The state machine flips so
// "composing" (the typed-sentence path) is the default surface. Selection
// mode demotes to opt-in.
//
//   off        — idle, nothing on screen but the demoted FrictionButton.
//   composing  — composer mounted bottom-right; body textarea autofocused.
//   selecting  — opt-in anchor mode; composer hides, overlay arms.
//
// Transitions:
//   off → composing             (⌘⇧F or click on FrictionButton)
//   composing → selecting       (⌘. or 📍 button in the composer)
//   selecting → composing       (anchor captured; or ESC w/ existing draft? no — ESC clears entirely)
//   composing → off             (ESC, submit success, ⌘⇧F again)
//   selecting → off             (ESC, click outside after 50ms suppression)
export type FrictionMode = "off" | "composing" | "selecting";

export const PANE_MIN_WIDTH = 180;
export const PANE_MAX_WIDTH = 480;
export const PANE_DEFAULT_WIDTH = 256;

export function clampPaneWidth(width: number): number {
  if (width < PANE_MIN_WIDTH) return PANE_MIN_WIDTH;
  if (width > PANE_MAX_WIDTH) return PANE_MAX_WIDTH;
  return Math.round(width);
}

const densityStore = persisted<PaletteDensity>(
  "designer.paletteDensity",
  "open",
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
  paletteDensity: PaletteDensity;
  projectStripVisible: boolean;
  sidebarVisible: boolean;
  spineVisible: boolean;
  sidebarWidth: number;
  spineWidth: number;
  dialog: AppDialog;
  /* Optimistic autonomy per project. The real mutation will land in Phase
   * 13 via IPC; in the meantime this makes the HomeTabA Autonomy control
   * feel responsive instead of being a false affordance. When IPC lands
   * we swap the reader to prefer the server value. */
  autonomyOverrides: Record<ProjectId, Autonomy>;
  // Track 13.K / 13.M — Friction.
  frictionMode: FrictionMode;
  frictionAnchor: Anchor | null;
  /**
   * Phase 21.A1.1 — Designer noticed unread badge state.
   *
   * `noticedLastViewedSeq` is the highest event-stream sequence the
   * user has seen (set when the workspace home or the Settings
   * archive is opened). `noticedUnreadCount` is derived in the UI
   * from `events.filter(e => e.kind === "finding_recorded" &&
   * e.sequence > noticedLastViewedSeq).length`. Stored as a sequence
   * cursor (not a timestamp) so the read state survives clock skew
   * and matches the same monotonic ordering the event store uses.
   */
  noticedLastViewedSeq: number;
}

export const appStore = createStore<AppState>({
  activeProject: null,
  activeWorkspace: null,
  activeTabByWorkspace: {},
  quickSwitcherOpen: false,
  followingAgent: null,
  inboxOpen: false,
  paletteDensity: densityStore.read(),
  projectStripVisible: true,
  sidebarVisible: sidebarVisibleStore.read(),
  spineVisible: spineVisibleStore.read(),
  sidebarWidth: sidebarWidthStore.read(),
  spineWidth: spineWidthStore.read(),
  dialog: null,
  autonomyOverrides: {},
  frictionMode: "off",
  frictionAnchor: null,
  noticedLastViewedSeq: 0,
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

export const toggleProjectStrip = (visible?: boolean) =>
  appStore.set((s) => {
    const next = visible ?? !s.projectStripVisible;
    return s.projectStripVisible === next ? s : { ...s, projectStripVisible: next };
  });

export const setAutonomyOverride = (projectId: ProjectId, level: Autonomy) =>
  appStore.set((s) =>
    s.autonomyOverrides[projectId] === level
      ? s
      : {
          ...s,
          autonomyOverrides: { ...s.autonomyOverrides, [projectId]: level },
        },
  );

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

export const openCreateProject = () => openDialog("create-project");

export const closeCreateProject = () =>
  appStore.set((s) =>
    s.dialog === "create-project" ? { ...s, dialog: null } : s,
  );

// ---- Track 13.K / 13.M Friction actions ---------------------------------

/**
 * Primary trigger for the composer. ⌘⇧F or click on FrictionButton. Toggles
 * between "off" and "composing"; if the user is already in selection mode,
 * a second invocation cancels everything.
 *
 * This replaces 13.K's `toggleFrictionSelecting` — the typed-sentence path
 * is now the default; selection demotes to an opt-in `enterFrictionSelecting`.
 */
export const toggleFrictionComposer = () => {
  appStore.set((s) => {
    // Inert when any modal scrim is open — prevents the user from opening
    // the composer while a settings page or dialog covers the viewport.
    if (s.dialog !== null) return s;
    const next: FrictionMode = s.frictionMode === "off" ? "composing" : "off";
    return { ...s, frictionMode: next, frictionAnchor: null };
  });
};

/** Opt-in selection mode. Called from inside the composer (⌘. or 📍 button). */
export const enterFrictionSelecting = () =>
  appStore.set((s) =>
    s.frictionMode === "composing" ? { ...s, frictionMode: "selecting" } : s,
  );

/** Bail out of selection mode back to the composer (ESC inside the overlay). */
export const exitFrictionSelecting = () =>
  appStore.set((s) =>
    s.frictionMode === "selecting" ? { ...s, frictionMode: "composing" } : s,
  );

/**
 * Anchor captured from the overlay. Returns the user to the composer with
 * the descriptor showing as a chip.
 */
export const setFrictionAnchor = (anchor: Anchor) =>
  appStore.set((s) => ({
    ...s,
    frictionMode: "composing",
    frictionAnchor: anchor,
  }));

/** Clear the anchor while keeping the composer open (× on the chip). */
export const clearFrictionAnchor = () =>
  appStore.set((s) =>
    s.frictionAnchor === null ? s : { ...s, frictionAnchor: null },
  );

/** Fully clear friction state — submit success, ESC, ⌘⇧F again. */
export const clearFriction = () =>
  appStore.set((s) =>
    s.frictionMode === "off" && s.frictionAnchor === null
      ? s
      : { ...s, frictionMode: "off", frictionAnchor: null },
  );

// ---- Phase 21.A1.1 Designer noticed unread badge ------------------------

/**
 * Mark the noticed feed as viewed. Called when the user opens the
 * workspace home (mounts `DesignerNoticedHome`) or the Settings
 * archive. Advances the cursor to the latest known sequence so the
 * badge clears.
 */
export const markNoticedViewed = () => {
  const events = dataStore.get().events;
  const max = events.reduce<number>(
    (acc, e) => (e.sequence > acc ? e.sequence : acc),
    0,
  );
  appStore.set((s) =>
    s.noticedLastViewedSeq >= max ? s : { ...s, noticedLastViewedSeq: max },
  );
};
