// Normalized events and wire protocol shared by server and web UI.

export type PermissionMode = 'default' | 'auto' | 'acceptEdits' | 'bypassPermissions';
export type ToolKind = 'command' | 'file_change' | 'read' | 'search' | 'other';
export type ToolStatus = 'running' | 'done' | 'error';
export type Decision = 'allow' | 'deny';

/** One question from the model's AskUserQuestion tool. */
export interface QuestionOption { label: string; description: string; preview?: string }
export interface Question { question: string; header: string; options: QuestionOption[]; multiSelect: boolean }
/** How a question card ended: picked answers, skipped, "reply in chat instead", or cancelled (Stop, session end). */
export type AnswerHow = 'answered' | 'skipped' | 'chat' | 'cancelled';

/** Events persisted to the thread log (deltas are live-only, see LiveEvent). */
export type AgentEvent =
  | { type: 'user_message'; text: string }
  | { type: 'assistant_message'; messageId: string; text: string }
  | { type: 'tool_call'; id: string; kind: ToolKind; name: string; label: string; status: ToolStatus; input?: unknown; output?: string }
  | { type: 'approval_request'; requestId: string; toolName: string; label: string; input: unknown }
  | { type: 'approval_resolved'; requestId: string; decision: Decision }
  | { type: 'question_request'; requestId: string; questions: Question[] }
  | { type: 'question_answered'; requestId: string; answers: Record<string, string>; how: AnswerHow }
  | { type: 'error'; message: string }
  | { type: 'turn_done'; costUsd?: number; interrupted?: boolean };

export type StoredEvent = AgentEvent & { threadId: string; seq: number; ts: number };

/** Live-only streaming deltas; coalesced by the server, never written to the log. */
export type LiveDelta = { type: 'assistant_delta'; threadId: string; messageId: string; text: string };

export interface Workspace {
  id: string;
  name: string;
  /** Directory sessions run in. */
  path: string;
  /** 'folder' is any directory used as is; 'worktree' is a git worktree we created. */
  kind: 'folder' | 'worktree';
  /** For worktrees: the repo it was created from, and its branch. */
  repoPath?: string;
  branch?: string;
  createdAt: number;
}

export interface ThreadMeta {
  id: string;
  workspaceId: string;
  archived?: boolean;
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
  | { type: 'list_workspaces' }
  | { type: 'add_folder'; path: string }
  | { type: 'create_worktree'; fromWorkspaceId: string; name: string }
  | { type: 'remove_workspace'; workspaceId: string }
  | { type: 'create_thread'; workspaceId: string }
  | { type: 'archive_thread'; threadId: string }
  | { type: 'subscribe'; threadId: string; lastSeq: number }
  | { type: 'send'; threadId: string; text: string }
  | { type: 'interrupt'; threadId: string }
  | { type: 'respond'; threadId: string; requestId: string; decision: Decision }
  | { type: 'answer'; threadId: string; requestId: string; answers: Record<string, string>; how: AnswerHow }
  | { type: 'set_mode'; threadId: string; mode: PermissionMode };

export type ServerMsg =
  | { type: 'hello'; defaultCwd: string; previewPort: number }
  | { type: 'workspaces'; workspaces: Workspace[] }
  | { type: 'workspace_updated'; workspace: Workspace }
  | { type: 'workspace_removed'; workspaceId: string }
  | { type: 'threads'; threads: ThreadMeta[] }
  | { type: 'thread_updated'; thread: ThreadMeta }
  | { type: 'event'; event: StoredEvent }
  | { type: 'delta'; delta: LiveDelta }
  | { type: 'replay_done'; threadId: string; lastSeq: number }
  | { type: 'error'; message: string };

export * from './edits.js';
