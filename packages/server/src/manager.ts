import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { AgentEvent, ClientMsg, Decision, ImageUpload, PermissionMode, ServerMsg, ThreadMeta, Workspace } from '@designer/shared';
import { checkImages } from './attachments.js';
import type { ProviderAdapter, Session } from './adapter.js';
import { addWorktree, removeWorktree, repoRoot } from './git.js';
import type { Store } from './store.js';

export interface Client {
  send(msg: ServerMsg): void;
  subs: Set<string>;
}

const FLUSH_MS = 33;

export class Manager {
  private sessions = new Map<string, Session>();
  private clients = new Set<Client>();
  private deltaBuf = new Map<string, Map<string, string>>(); // threadId -> messageId -> text
  private flushTimer?: NodeJS.Timeout;
  private modes = new Map<string, PermissionMode>();

  private workspaces: Workspace[];

  constructor(private store: Store, private adapter: ProviderAdapter, private worktreeRoot: string) {
    this.workspaces = store.listWorkspaces();
    for (const t of store.listThreads()) {
      let next = t;
      // A crash can leave threads marked running; nothing is running after a restart.
      if (t.status === 'running') next = { ...next, status: 'idle' };
      // Threads from before workspaces existed: group them under a folder workspace by cwd.
      if (!t.workspaceId) next = { ...next, workspaceId: this.folderWorkspace(t.cwd).id };
      if (next !== t) store.writeMeta(next);
    }
  }

  workspacePath(id: string): string | undefined {
    return this.workspaces.find((w) => w.id === id)?.path;
  }

  private folderWorkspace(path: string): Workspace {
    const found = this.workspaces.find((w) => w.path === path);
    if (found) return found;
    const w: Workspace = { id: randomUUID(), name: basename(path) || path, path, kind: 'folder', createdAt: Date.now() };
    this.workspaces.push(w);
    this.store.saveWorkspaces(this.workspaces);
    return w;
  }

  addClient(c: Client) {
    this.clients.add(c);
  }
  removeClient(c: Client) {
    this.clients.delete(c);
  }

  handle(c: Client, msg: ClientMsg) {
    switch (msg.type) {
      case 'list_threads':
        return c.send({ type: 'threads', threads: this.store.listThreads() });
      case 'list_workspaces':
        return c.send({ type: 'workspaces', workspaces: this.workspaces });
      case 'add_folder':
        return void this.guard(c, () => this.addFolder(msg.path, c));
      case 'create_worktree':
        return void this.guard(c, () => this.createWorktree(msg.fromWorkspaceId, msg.name));
      case 'remove_workspace':
        return void this.guard(c, () => this.removeWorkspace(msg.workspaceId));
      case 'create_thread':
        return this.create(c, msg.workspaceId);
      case 'archive_thread':
        return this.archive(c, msg.threadId);
      case 'subscribe':
        return this.subscribe(c, msg.threadId, msg.lastSeq);
      case 'send':
        return void this.send(c, msg.threadId, msg.text, msg.images);
      case 'interrupt':
        return void this.sessions.get(msg.threadId)?.interrupt();
      case 'set_mode':
        return this.setMode(msg.threadId, msg.mode);
      case 'respond':
        return this.sessions.get(msg.threadId)?.respond(msg.requestId, msg.decision as Decision);
      case 'answer':
        return this.sessions.get(msg.threadId)?.answer(msg.requestId, msg.answers ?? {}, msg.how);
    }
  }

  private async guard(c: Client, fn: () => Promise<void>) {
    try {
      await fn();
    } catch (e) {
      c.send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private async addFolder(path: string, c: Client) {
    try {
      if (!statSync(path).isDirectory()) throw new Error();
    } catch {
      throw new Error(`Folder not found: ${path}`);
    }
    const found = await repoRoot(path);
    const root = found ?? path; // inside a repo: use the repo root so worktrees work
    const existing = this.workspaces.find((w) => w.path === root);
    const w = existing ?? this.folderWorkspace(root);
    this.broadcastAll({ type: 'workspace_updated', workspace: w });
    if (!this.store.listThreads().some((t) => t.workspaceId === w.id && !t.archived)) this.newThread(w);
    // Added all the same (a plain folder is fine for chatting), but say plainly what it cannot do, whether it was typed or chosen.
    if (!found) c.send({ type: 'notice', message: `${root} is not a git repository. It was added, but worktrees and branches need one (run git init there).` });
  }

  private async createWorktree(fromId: string, name: string) {
    const base = this.workspaces.find((x) => x.id === fromId);
    if (!base) throw new Error('Unknown workspace');
    const repo = base.repoPath ?? (await repoRoot(base.path));
    if (!repo) throw new Error('That folder is not a git repository, so it cannot have worktrees.');
    const path = join(this.worktreeRoot, basename(repo), name);
    if (this.workspaces.some((w) => w.path === path)) throw new Error(`A workspace named "${name}" already exists.`);
    const branch = await addWorktree(repo, path, name);
    const w: Workspace = { id: randomUUID(), name, path, kind: 'worktree', repoPath: repo, branch, createdAt: Date.now() };
    this.workspaces.push(w);
    this.store.saveWorkspaces(this.workspaces);
    this.broadcastAll({ type: 'workspace_updated', workspace: w });
    this.newThread(w);
  }

  private async removeWorkspace(id: string) {
    const w = this.workspaces.find((x) => x.id === id);
    if (!w) return;
    const live = this.store.listThreads().filter((t) => t.workspaceId === id && t.status === 'running');
    if (live.length) throw new Error('Stop the running session first.');
    // Worktrees are removed from disk only if clean; folders are never deleted, only forgotten.
    if (w.kind === 'worktree' && w.repoPath) await removeWorktree(w.repoPath, w.path);
    for (const t of this.store.listThreads().filter((x) => x.workspaceId === id)) {
      this.sessions.get(t.id)?.close();
      this.sessions.delete(t.id);
      this.update(t, { archived: true });
    }
    this.workspaces = this.workspaces.filter((x) => x.id !== id);
    this.store.saveWorkspaces(this.workspaces);
    this.broadcastAll({ type: 'workspace_removed', workspaceId: id });
  }

  private create(c: Client, workspaceId: string) {
    const w = this.workspaces.find((x) => x.id === workspaceId);
    if (!w) return c.send({ type: 'error', message: 'Unknown workspace' });
    this.newThread(w);
  }

  private newThread(w: Workspace) {
    const now = Date.now();
    const meta: ThreadMeta = { id: randomUUID(), workspaceId: w.id, title: 'New chat', cwd: w.path, provider: 'claude', status: 'idle', permissionMode: 'auto', createdAt: now, updatedAt: now };
    this.store.writeMeta(meta);
    this.broadcastAll({ type: 'thread_updated', thread: meta });
  }

  private archive(c: Client, threadId: string) {
    const m = this.store.readMeta(threadId);
    if (!m) return;
    if (m.status === 'running') return c.send({ type: 'error', message: 'Stop the session before closing it.' });
    this.sessions.get(threadId)?.close();
    this.sessions.delete(threadId);
    this.update(m, { archived: true });
  }

  private subscribe(c: Client, threadId: string, lastSeq: number) {
    if (!this.store.readMeta(threadId)) return c.send({ type: 'error', message: 'Unknown thread' });
    c.subs.add(threadId);
    for (const event of this.store.readEvents(threadId, lastSeq)) c.send({ type: 'event', event });
    c.send({ type: 'replay_done', threadId, lastSeq: this.store.readEvents(threadId).at(-1)?.seq ?? 0 });
  }

  private async send(c: Client, threadId: string, text: string, uploads?: ImageUpload[]) {
    const meta = this.store.readMeta(threadId);
    if (!meta) return c.send({ type: 'error', message: 'Unknown thread' });
    let images;
    try {
      images = checkImages(uploads);
    } catch (e) {
      return c.send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    }
    if (!text.trim() && !images.length) return;
    if (meta.status === 'running') return c.send({ type: 'error', message: 'A turn is already running. Stop it first.' });
    for (const im of images) this.store.saveAttachment(threadId, im.id, im.mime, im.bytes);
    const label = text.trim() || (images.length > 1 ? `${images.length} images` : 'Image');
    const title = meta.title === 'New chat' ? label.replace(/\s+/g, ' ').slice(0, 60) : meta.title;
    this.update(meta, { title, status: 'running' });
    this.emit(threadId, { type: 'user_message', text, ...(images.length ? { images: images.map(({ id, mime }) => ({ id, mime })) } : {}) });
    try {
      await this.session(threadId).send(text, images.map((im) => ({ mime: im.mime, data: im.bytes.toString('base64') })));
    } catch (e) {
      this.emit(threadId, { type: 'error', message: e instanceof Error ? e.message : String(e) });
      this.setRunning(threadId, false);
    }
  }

  private setMode(threadId: string, mode: PermissionMode) {
    this.modes.set(threadId, mode);
    const m = this.store.readMeta(threadId);
    if (m) this.update(m, { permissionMode: mode });
    void this.sessions.get(threadId)?.setPermissionMode(mode);
  }

  private session(threadId: string): Session {
    let s = this.sessions.get(threadId);
    if (s) return s;
    const meta = this.store.readMeta(threadId)!;
    s = this.adapter.start(
      // 'default' here is deliberate for chats saved before new chats started in 'auto'; never loosen those silently.
      { cwd: meta.cwd, resumeId: meta.nativeSessionId, permissionMode: this.modes.get(threadId) ?? meta.permissionMode ?? 'default' },
      {
        emit: (ev) => this.emit(threadId, ev),
        delta: (messageId, text) => this.bufferDelta(threadId, messageId, text),
        nativeId: (id) => {
          const m = this.store.readMeta(threadId);
          if (m && m.nativeSessionId !== id) this.update(m, { nativeSessionId: id });
        },
        running: (r) => this.setRunning(threadId, r),
      },
    );
    this.sessions.set(threadId, s);
    return s;
  }

  private setRunning(threadId: string, running: boolean) {
    const m = this.store.readMeta(threadId);
    const status = running ? 'running' : 'idle';
    if (m && m.status !== status) this.update(m, { status });
  }

  private update(meta: ThreadMeta, patch: Partial<ThreadMeta>) {
    const next = { ...meta, ...patch, updatedAt: Date.now() };
    this.store.writeMeta(next);
    this.broadcastAll({ type: 'thread_updated', thread: next });
  }

  private emit(threadId: string, ev: AgentEvent) {
    this.flushDeltas(); // keep deltas ordered before the persisted event
    const event = this.store.append(threadId, ev);
    for (const c of this.clients) if (c.subs.has(threadId)) c.send({ type: 'event', event });
  }

  private bufferDelta(threadId: string, messageId: string, text: string) {
    let m = this.deltaBuf.get(threadId);
    if (!m) this.deltaBuf.set(threadId, (m = new Map()));
    m.set(messageId, (m.get(messageId) ?? '') + text);
    this.flushTimer ??= setTimeout(() => this.flushDeltas(), FLUSH_MS);
  }

  private flushDeltas() {
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    for (const [threadId, msgs] of this.deltaBuf) {
      for (const [messageId, text] of msgs) {
        for (const c of this.clients) if (c.subs.has(threadId)) c.send({ type: 'delta', delta: { type: 'assistant_delta', threadId, messageId, text } });
      }
    }
    this.deltaBuf.clear();
  }

  private broadcastAll(msg: ServerMsg) {
    for (const c of this.clients) c.send(msg);
  }

  shutdown() {
    for (const s of this.sessions.values()) s.close();
  }
}
