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

/**
 * Which "no workspace" surface to render in the main pane. Mirrors the
 * top-level sidebar tabs (Home, Archived). When `activeWorkspace` is
 * non-null this is ignored — the workspace owns the main pane.
 */
export type ProjectView = "home" | "archived";

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
  /**
   * Which project-level view to render when no workspace is selected.
   * Driven by the sidebar's Home / Archived tabs.
   */
  activeView: ProjectView;
  activeTabByWorkspace: Record<WorkspaceId, TabId>;
  /**
   * Per-tab composer draft. Keyed by tab id so leaving a tab and
   * returning preserves the in-progress text the user typed. Without
   * this, ComposeDock's local state was reset every tab switch — the
   * draft-loss friction report.
   */
  composerDraftByTab: Record<TabId, string>;
  /**
   * Per-tab "user has started a conversation here" flag. Drives whether
   * WorkspaceThread shows the starter-suggestions empty state or the
   * thread itself. Persisting it prevents the empty state from flashing
   * on every tab switch back to a tab that already has activity — the
   * tab-switch flash friction report.
   */
  tabStartedById: Record<TabId, boolean>;
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
   * Phase 21.A1.2 — Designer noticed unread badge state.
   *
   * `noticedLastViewedSeq` is the highest event-stream sequence the
   * user has seen (set when the workspace home or the Settings
   * archive is opened). The unread count is derived in the UI from
   * `events.filter(e => e.kind === "proposal_emitted" &&
   * e.sequence > noticedLastViewedSeq).length` — proposals, **not**
   * findings. The 21.A1.1 model that counted `finding_recorded` is
   * superseded: findings are scratch buffer state, not user-facing
   * units, so they never increment the badge.
   *
   * Stored as a sequence cursor (not a timestamp) so the read state
   * survives clock skew and matches the same monotonic ordering the
   * event store uses.
   */
  noticedLastViewedSeq: number;
}

export const appStore = createStore<AppState>({
  activeProject: null,
  activeWorkspace: null,
  activeView: "home",
  activeTabByWorkspace: {},
  composerDraftByTab: {},
  tabStartedById: {},
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
    s.activeProject === id && s.activeWorkspace === null && s.activeView === "home"
      ? s
      : { ...s, activeProject: id, activeWorkspace: null, activeView: "home" },
  );

export const selectWorkspace = (id: WorkspaceId | null) =>
  appStore.set((s) => {
    // Selecting a workspace doesn't change activeView, but clearing the
    // selection (id === null) snaps back to Home so that returning to the
    // project-root state always lands the user on the canonical view.
    if (id === null) {
      if (s.activeWorkspace === null && s.activeView === "home") return s;
      return { ...s, activeWorkspace: null, activeView: "home" };
    }
    return s.activeWorkspace === id ? s : { ...s, activeWorkspace: id };
  });

/** Switch the project-level view to Home, dropping any workspace selection. */
export const selectHomeView = () =>
  appStore.set((s) =>
    s.activeWorkspace === null && s.activeView === "home"
      ? s
      : { ...s, activeWorkspace: null, activeView: "home" },
  );

/** Switch the project-level view to Archived, dropping any workspace selection. */
export const selectArchivedView = () =>
  appStore.set((s) =>
    s.activeWorkspace === null && s.activeView === "archived"
      ? s
      : { ...s, activeWorkspace: null, activeView: "archived" },
  );

export const selectTab = (workspaceId: WorkspaceId, tabId: TabId) =>
  appStore.set((s) =>
    s.activeTabByWorkspace[workspaceId] === tabId
      ? s
      : {
          ...s,
          activeTabByWorkspace: { ...s.activeTabByWorkspace, [workspaceId]: tabId },
        },
  );

/** Save (or clear) the composer draft for a tab. Empty string deletes
 *  the entry so the map doesn't grow unbounded with closed tabs. */
export const setTabDraft = (tabId: TabId, text: string) =>
  appStore.set((s) => {
    const current = s.composerDraftByTab[tabId] ?? "";
    if (current === text) return s;
    const next = { ...s.composerDraftByTab };
    if (text.length === 0) {
      delete next[tabId];
    } else {
      next[tabId] = text;
    }
    return { ...s, composerDraftByTab: next };
  });

/** Mark a tab as "the user has started a conversation here." Causes
 *  WorkspaceThread to render the message thread instead of the
 *  starter-suggestions empty state on every subsequent mount of that
 *  tab. Idempotent. */
export const markTabStarted = (tabId: TabId) =>
  appStore.set((s) =>
    s.tabStartedById[tabId]
      ? s
      : { ...s, tabStartedById: { ...s.tabStartedById, [tabId]: true } },
  );

/** Reap any per-tab state for a tab that's been closed. Without this,
 *  `composerDraftByTab` and `tabStartedById` accumulate stale entries
 *  for the lifetime of the session. Called from MainView right after
 *  the close-tab IPC succeeds. Safe to call for an unknown id (no-op). */
export const clearTabState = (tabId: TabId) =>
  appStore.set((s) => {
    const hadDraft = tabId in s.composerDraftByTab;
    const hadStarted = tabId in s.tabStartedById;
    if (!hadDraft && !hadStarted) return s;
    const composerDraftByTab = { ...s.composerDraftByTab };
    delete composerDraftByTab[tabId];
    const tabStartedById = { ...s.tabStartedById };
    delete tabStartedById[tabId];
    return { ...s, composerDraftByTab, tabStartedById };
  });

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

// ---- Phase 21.A1.2 Designer noticed unread badge ------------------------

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
