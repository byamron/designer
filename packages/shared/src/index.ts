// Normalized events and wire protocol shared by server and web UI.

export type PermissionMode = 'default' | 'acceptEdits' | 'bypassPermissions';
export type ToolKind = 'command' | 'file_change' | 'read' | 'search' | 'other';
export type ToolStatus = 'running' | 'done' | 'error';
export type Decision = 'allow' | 'deny';

/** Events persisted to the thread log (deltas are live-only, see LiveEvent). */
export type AgentEvent =
  | { type: 'user_message'; text: string }
  | { type: 'assistant_message'; messageId: string; text: string }
  | { type: 'tool_call'; id: string; kind: ToolKind; name: string; label: string; status: ToolStatus; input?: unknown; output?: string }
  | { type: 'approval_request'; requestId: string; toolName: string; label: string; input: unknown }
  | { type: 'approval_resolved'; requestId: string; decision: Decision }
  | { type: 'error'; message: string }
  | { type: 'turn_done'; costUsd?: number; interrupted?: boolean };

export type StoredEvent = AgentEvent & { threadId: string; seq: number; ts: number };

/** Live-only streaming deltas; coalesced by the server, never written to the log. */
export type LiveDelta = { type: 'assistant_delta'; threadId: string; messageId: string; text: string };

export interface ThreadMeta {
  id: string;
  title: string;
  cwd: string;
  provider: 'claude';
  nativeSessionId?: string;
  status: 'idle' | 'running';
  permissionMode?: PermissionMode;
  createdAt: number;
  updatedAt: number;
}

export type ClientMsg =
  | { type: 'list_threads' }
  | { type: 'create_thread'; cwd: string; title?: string }
  | { type: 'subscribe'; threadId: string; lastSeq: number }
  | { type: 'send'; threadId: string; text: string }
  | { type: 'interrupt'; threadId: string }
  | { type: 'respond'; threadId: string; requestId: string; decision: Decision }
  | { type: 'set_mode'; threadId: string; mode: PermissionMode };

export type ServerMsg =
  | { type: 'hello'; defaultCwd: string }
  | { type: 'threads'; threads: ThreadMeta[] }
  | { type: 'thread_updated'; thread: ThreadMeta }
  | { type: 'event'; event: StoredEvent }
  | { type: 'delta'; delta: LiveDelta }
  | { type: 'replay_done'; threadId: string; lastSeq: number }
  | { type: 'error'; message: string };
