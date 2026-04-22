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

/**
 * Prompt the user for project details and create one. Shared by the `+` icon
 * in the project strip and the File > New Project… menu item so both paths
 * stay in sync. Returns the created project id, or null if the user cancelled.
 */
export async function promptCreateProject(): Promise<string | null> {
  const name = window.prompt("New project name?")?.trim();
  if (!name) return null;
  const root = window.prompt("Repo root path?", "~/code/")?.trim();
  if (!root) return null;
  const summary = await ipcClient().createProject({ name, root_path: root });
  await refreshProjects();
  return summary.project.id;
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
