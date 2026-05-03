// Data store: projects, workspaces, spines. Kept in a single object so the
// consumer can select slices with the useStore hook.

import { useEffect, useState } from "react";
import { createStore, useStore } from "./index";
import { ipcClient } from "../ipc/client";
import type {
  ActivityState,
  ProjectId,
  ProjectSummary,
  SpineRow,
  StreamEvent,
  TabId,
  WorkspaceId,
  WorkspaceSummary,
} from "../ipc/types";

export interface DataState {
  projects: ProjectSummary[];
  workspaces: Record<ProjectId, WorkspaceSummary[]>;
  spines: Record<string, SpineRow[]>;
  events: StreamEvent[];
  /**
   * Last event timestamp (ms epoch) per stream_id. Drives the
   * `data-active-ts-recent` gate on state dots so pulse animation
   * only runs while an agent is *actually* posting events — the
   * `state === "active"` projection used to be too sticky on its
   * own (counted recently-touched workspaces as active even after
   * the agent stopped). Combined with `state="active"` in CSS.
   */
  recentActivityTs: Record<string, number>;
  /**
   * Phase 23.B — coarse per-tab activity surface keyed by
   * `${workspace_id}:${tab_id}`. The compose-dock activity row reads
   * this to render the pulsing dot + elapsed counter; the tab-strip
   * badge reads it to mark non-active tabs as `working` /
   * `awaiting_approval`. Entries persist while their state !=
   * `idle`; we drop the entry on `idle` so render-time membership
   * checks ("anything happening here?") stay cheap.
   *
   * `since_ms` is the unix-epoch wall-clock at the transition; the
   * dock's elapsed counter renders `now - since_ms`.
   */
  activity: Record<string, { state: ActivityState; since_ms: number }>;
  loaded: boolean;
}

/**
 * Phase 23.B — derive the activity-slice key for a (workspace, tab)
 * pair. Centralized so producers (the orchestrator subscriber) and
 * consumers (ComposeDock, TabButton badge) can't drift on the
 * encoding. Empty/missing tab id falls back to `*` so legacy
 * workspace-wide events still find a slot, mirroring the Rust
 * default-tab fallback in `core_agents`.
 */
export function activityKey(workspaceId: WorkspaceId, tabId: TabId | null | undefined): string {
  return `${workspaceId}:${tabId ?? "*"}`;
}

/**
 * How long a stream stays "recently active" after its last event,
 * in ms. Drives the pulse gate on state dots.
 */
export const ACTIVE_RECENCY_MS = 8_000;

export const dataStore = createStore<DataState>({
  projects: [],
  workspaces: {},
  spines: {},
  events: [],
  recentActivityTs: {},
  activity: {},
  loaded: false,
});

export const useDataState = <U,>(selector: (s: DataState) => U) =>
  useStore(dataStore, selector);

export async function bootData() {
  const client = ipcClient();
  const [projects, projectSpine] = await Promise.all([
    client.listProjects(),
    client.spine(null),
  ]);
  const workspaceLists = await Promise.all(
    projects.map((p) => client.listWorkspaces(p.project.id)),
  );
  const workspaces: Record<ProjectId, WorkspaceSummary[]> = {};
  projects.forEach((p, i) => {
    workspaces[p.project.id] = workspaceLists[i];
  });
  const flatWorkspaces = workspaceLists.flat();
  const workspaceSpines = await Promise.all(
    flatWorkspaces.map((w) => client.spine(w.workspace.id)),
  );
  const spines: Record<string, SpineRow[]> = { "project:*": projectSpine };
  flatWorkspaces.forEach((w, i) => {
    spines[`workspace:${w.workspace.id}`] = workspaceSpines[i];
  });
  dataStore.set({
    projects,
    workspaces,
    spines,
    events: [],
    recentActivityTs: {},
    activity: {},
    loaded: true,
  });

  client.stream((event) => {
    const eventTs = Date.parse(event.timestamp);
    const ts = Number.isFinite(eventTs) ? eventTs : Date.now();
    dataStore.set((s) => ({
      ...s,
      events: [...s.events, event].slice(-500),
      recentActivityTs: { ...s.recentActivityTs, [event.stream_id]: ts },
    }));
  });

  // Phase 23.B: per-tab activity slice. `idle` transitions drop the
  // entry so a one-shot membership check on the activity map answers
  // "is anything happening for this tab?" without iterating values.
  client.activityStream((event) => {
    const key = activityKey(event.workspace_id, event.tab_id);
    dataStore.set((s) => {
      const next = { ...s.activity };
      if (event.state === "idle") {
        delete next[key];
      } else {
        next[key] = { state: event.state, since_ms: event.since_ms };
      }
      return { ...s, activity: next };
    });
  });
}

/**
 * Returns the most recent event timestamp (ms) for any stream id
 * matching the workspace — either the workspace_id itself or any
 * sub-stream prefixed with `${workspaceId}:`. 0 if none.
 */
export function latestActivityForWorkspace(
  recentActivityTs: Record<string, number>,
  workspaceId: WorkspaceId,
): number {
  let max = 0;
  for (const [id, ts] of Object.entries(recentActivityTs)) {
    if (id === workspaceId || id.startsWith(`${workspaceId}:`)) {
      if (ts > max) max = ts;
    }
  }
  return max;
}

/**
 * Returns the most recent event timestamp (ms) for the given
 * stream id, considered as either an exact match or an
 * `${activeWorkspace}:${rowId}` sub-stream. 0 if none.
 */
export function latestActivityForStream(
  recentActivityTs: Record<string, number>,
  streamId: string,
): number {
  let max = 0;
  for (const [id, ts] of Object.entries(recentActivityTs)) {
    if (id === streamId || id.endsWith(`:${streamId}`)) {
      if (ts > max) max = ts;
    }
  }
  return max;
}

/**
 * Returns true while the given last-event timestamp is within
 * `windowMs` of the current clock. Re-renders once after `windowMs`
 * elapses so the gate flips back to false without further events
 * (avoids the "pulse forever after one event" footgun).
 */
export function useRecentActivity(
  latestTs: number,
  windowMs: number = ACTIVE_RECENCY_MS,
): boolean {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!latestTs) return;
    const remaining = windowMs - (Date.now() - latestTs);
    if (remaining <= 0) return;
    const handle = window.setTimeout(
      () => setTick((t) => t + 1),
      remaining + 50,
    );
    return () => window.clearTimeout(handle);
  }, [latestTs, windowMs]);
  return latestTs > 0 && Date.now() - latestTs < windowMs;
}

export async function refreshProjects() {
  const projects = await ipcClient().listProjects();
  dataStore.set((s) => ({ ...s, projects }));
}

export async function refreshWorkspaces(projectId: ProjectId) {
  const rows = await ipcClient().listWorkspaces(projectId);
  dataStore.set((s) => ({
    ...s,
    workspaces: { ...s.workspaces, [projectId]: rows },
  }));
}

export async function refreshSpine(workspaceId: WorkspaceId | null) {
  const key = workspaceId ? `workspace:${workspaceId}` : "project:*";
  const rows = await ipcClient().spine(workspaceId);
  dataStore.set((s) => ({
    ...s,
    spines: { ...s.spines, [key]: rows },
  }));
}
