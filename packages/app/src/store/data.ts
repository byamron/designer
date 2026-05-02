// Data store: projects, workspaces, spines. Kept in a single object so the
// consumer can select slices with the useStore hook.

import { useEffect, useState } from "react";
import { createStore, useStore } from "./index";
import { ipcClient } from "../ipc/client";
import type {
  ProjectId,
  ProjectSummary,
  SpineRow,
  StreamEvent,
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
  loaded: boolean;
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
