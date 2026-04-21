// Data store: projects, workspaces, spines. Kept in a single object so the
// consumer can select slices with the useStore hook.

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
  loaded: boolean;
}

export const dataStore = createStore<DataState>({
  projects: [],
  workspaces: {},
  spines: {},
  events: [],
  loaded: false,
});

export const useDataState = <U,>(selector: (s: DataState) => U) =>
  useStore(dataStore, selector);

export async function bootData() {
  const client = ipcClient();
  const projects = await client.listProjects();
  const workspaces: Record<ProjectId, WorkspaceSummary[]> = {};
  for (const p of projects) {
    workspaces[p.project.id] = await client.listWorkspaces(p.project.id);
  }
  const spines: Record<string, SpineRow[]> = {
    "project:*": await client.spine(null),
  };
  for (const group of Object.values(workspaces)) {
    for (const w of group) {
      spines[`workspace:${w.workspace.id}`] = await client.spine(w.workspace.id);
    }
  }
  dataStore.set({
    projects,
    workspaces,
    spines,
    events: [],
    loaded: true,
  });

  client.stream((event) => {
    dataStore.set((s) => ({
      ...s,
      events: [...s.events, event].slice(-500),
    }));
  });
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
