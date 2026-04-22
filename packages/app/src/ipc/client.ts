// Typed IPC client. When running inside Tauri, delegates to the `invoke` API.
// When running in a browser (dev, Storybook-like flows, tests), delegates to a
// deterministic in-memory mock so the surface is exercisable without the
// WebView runtime. The frontend never knows which runtime it's on — the mock
// enforces the same rules the real core would (approval gates, cost caps,
// scope rules).

import type {
  CreateProjectRequest,
  CreateWorkspaceRequest,
  OpenTabRequest,
  ProjectId,
  ProjectSummary,
  SpineRow,
  Tab,
  WorkspaceId,
  WorkspaceSummary,
  StreamEvent,
} from "./types";
import { createMockCore, type MockCore } from "./mock";

export interface IpcClient {
  listProjects(): Promise<ProjectSummary[]>;
  createProject(req: CreateProjectRequest): Promise<ProjectSummary>;
  listWorkspaces(id: ProjectId): Promise<WorkspaceSummary[]>;
  createWorkspace(req: CreateWorkspaceRequest): Promise<WorkspaceSummary>;
  openTab(req: OpenTabRequest): Promise<Tab>;
  spine(id: WorkspaceId | null): Promise<SpineRow[]>;
  stream(handler: (event: StreamEvent) => void): () => void;
  // Safety surfaces
  requestApproval(
    workspaceId: WorkspaceId,
    gate: string,
    summary: string,
  ): Promise<string>;
  resolveApproval(id: string, granted: boolean, reason?: string): Promise<void>;
}

// Tauri v2 sets `__TAURI_INTERNALS__` on the global as soon as the webview
// boots. Dynamic-import the API modules so web/test builds don't try to load
// native bridges that aren't there.
function isTauri(): boolean {
  return typeof globalThis !== "undefined" && "__TAURI_INTERNALS__" in globalThis;
}

const EVENT_STREAM_CHANNEL = "designer://event-stream";

class TauriIpcClient implements IpcClient {
  private listenerTeardowns = new Set<() => void>();

  private async invoke<T>(
    cmd: string,
    args?: Record<string, unknown>,
  ): Promise<T> {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<T>(cmd, args);
  }

  listProjects() {
    return this.invoke<ProjectSummary[]>("list_projects");
  }
  createProject(req: CreateProjectRequest) {
    return this.invoke<ProjectSummary>("create_project", { req });
  }
  listWorkspaces(id: ProjectId) {
    return this.invoke<WorkspaceSummary[]>("list_workspaces", {
      projectId: id,
    });
  }
  createWorkspace(req: CreateWorkspaceRequest) {
    return this.invoke<WorkspaceSummary>("create_workspace", { req });
  }
  openTab(req: OpenTabRequest) {
    return this.invoke<Tab>("open_tab", { req });
  }
  spine(id: WorkspaceId | null) {
    return this.invoke<SpineRow[]>("spine", { workspaceId: id });
  }

  stream(handler: (event: StreamEvent) => void) {
    let unlisten: (() => void) | null = null;
    let torn = false;
    (async () => {
      const { listen } = await import("@tauri-apps/api/event");
      const u = await listen<StreamEvent>(EVENT_STREAM_CHANNEL, (e) => {
        handler(e.payload);
      });
      if (torn) {
        u();
      } else {
        unlisten = u;
        this.listenerTeardowns.add(u);
      }
    })().catch((err) => {
      // Event listener failed to register — usually because capabilities
      // don't allow listen, or the webview isn't a Tauri context. Log and
      // hand back a no-op teardown so callers don't crash.
      console.warn("event stream subscription failed", err);
    });
    return () => {
      torn = true;
      if (unlisten) {
        unlisten();
        this.listenerTeardowns.delete(unlisten);
      }
    };
  }

  requestApproval(workspaceId: WorkspaceId, gate: string, summary: string) {
    return this.invoke<string>("request_approval", {
      workspaceId,
      gate,
      summary,
    });
  }
  resolveApproval(id: string, granted: boolean, reason?: string) {
    return this.invoke<void>("resolve_approval", { id, granted, reason });
  }
}

class MockIpcClient implements IpcClient {
  constructor(private readonly core: MockCore) {}
  listProjects() {
    return Promise.resolve(this.core.listProjects());
  }
  createProject(req: CreateProjectRequest) {
    return Promise.resolve(this.core.createProject(req));
  }
  listWorkspaces(id: ProjectId) {
    return Promise.resolve(this.core.listWorkspaces(id));
  }
  createWorkspace(req: CreateWorkspaceRequest) {
    return Promise.resolve(this.core.createWorkspace(req));
  }
  openTab(req: OpenTabRequest) {
    return Promise.resolve(this.core.openTab(req));
  }
  spine(id: WorkspaceId | null) {
    return Promise.resolve(this.core.spine(id));
  }
  stream(handler: (event: StreamEvent) => void) {
    return this.core.subscribe(handler);
  }
  requestApproval(workspaceId: WorkspaceId, gate: string, summary: string) {
    return Promise.resolve(this.core.requestApproval(workspaceId, gate, summary));
  }
  resolveApproval(id: string, granted: boolean, reason?: string) {
    this.core.resolveApproval(id, granted, reason);
    return Promise.resolve();
  }
}

let singleton: IpcClient | null = null;
export function ipcClient(): IpcClient {
  if (singleton) return singleton;
  singleton = isTauri() ? new TauriIpcClient() : new MockIpcClient(createMockCore());
  return singleton;
}

/** Testing: swap in an explicit client (e.g. the mock with seed data). */
export function __setIpcClient(client: IpcClient) {
  singleton = client;
}
