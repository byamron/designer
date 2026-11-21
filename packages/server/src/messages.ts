import type { ClientMsg, PermissionMode } from '@designer/shared';

const MODES: PermissionMode[] = ['default', 'auto', 'acceptEdits', 'bypassPermissions'];

/**
 * Check the shape of one WebSocket message from the browser before it reaches the manager. Only the fields each message
 * needs are checked (ids and text are strings, the mode is one we offer); the manager still validates what they mean.
 * Throws an Error whose message is safe to show. Without this, a message with a missing field threw inside an async
 * handler and took the whole server (and every running agent) down.
 */
export function parseClientMsg(raw: unknown): ClientMsg {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Bad message: expected an object.');
  const m = raw as Record<string, unknown>;
  const str = (k: string) => {
    if (typeof m[k] !== 'string') throw new Error(`Bad message: "${k}" must be text.`);
  };
  switch (m.type) {
    case 'list_threads':
    case 'list_workspaces':
      break;
    case 'add_folder': str('path'); break;
    case 'create_worktree': str('fromWorkspaceId'); str('name'); break;
    case 'remove_workspace': str('workspaceId'); break;
    case 'create_thread': str('workspaceId'); break;
    case 'archive_thread':
    case 'interrupt':
      str('threadId');
      break;
    case 'subscribe':
      str('threadId');
      if (typeof m.lastSeq !== 'number' || !Number.isFinite(m.lastSeq)) throw new Error('Bad message: "lastSeq" must be a number.');
      break;
    case 'send':
      str('threadId'); str('text');
      if (m.images !== undefined && !Array.isArray(m.images)) throw new Error('Bad message: "images" must be a list.');
      break;
    case 'respond':
      str('threadId'); str('requestId');
      if (m.decision !== 'allow' && m.decision !== 'deny') throw new Error('Bad message: "decision" must be allow or deny.');
      break;
    case 'answer':
      str('threadId'); str('requestId'); str('how');
      if (m.answers !== undefined && (!m.answers || typeof m.answers !== 'object' || Array.isArray(m.answers))) throw new Error('Bad message: "answers" must be an object.');
      break;
    case 'set_mode':
      str('threadId');
      if (!MODES.includes(m.mode as PermissionMode)) throw new Error('Bad message: unknown permission mode.');
      break;
    default:
      throw new Error('Bad message: unknown type.');
  }
  return raw as ClientMsg;
}
