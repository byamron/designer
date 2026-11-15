import type { AgentEvent, Decision } from '@designer/shared';

import type { PermissionMode } from '@designer/shared';
export type { PermissionMode };

/** What a provider session pushes back to the server. */
export interface SessionSink {
  emit(ev: AgentEvent): void;
  delta(messageId: string, text: string): void;
  nativeId(id: string): void;
  /** True while a turn is in flight. */
  running(running: boolean): void;
}

/** The only provider abstraction: one live session per thread. */
export interface Session {
  send(text: string): Promise<void>;
  interrupt(): Promise<void>;
  respond(requestId: string, decision: Decision): void;
  setPermissionMode(mode: PermissionMode): Promise<void>;
  close(): void;
}

export interface StartOpts {
  cwd: string;
  resumeId?: string;
  permissionMode: PermissionMode;
}

export interface ProviderAdapter {
  start(opts: StartOpts, sink: SessionSink): Session;
}
