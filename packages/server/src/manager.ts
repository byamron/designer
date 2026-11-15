import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import type { AgentEvent, ClientMsg, Decision, PermissionMode, ServerMsg, ThreadMeta } from '@designer/shared';
import type { ProviderAdapter, Session } from './adapter.js';
import type { Store } from './store.js';

export interface Client {
  send(msg: ServerMsg): void;
  subs: Set<string>;
}

const FLUSH_MS = 50;

export class Manager {
  private sessions = new Map<string, Session>();
  private clients = new Set<Client>();
  private deltaBuf = new Map<string, Map<string, string>>(); // threadId -> messageId -> text
  private flushTimer?: NodeJS.Timeout;
  private modes = new Map<string, PermissionMode>();

  constructor(private store: Store, private adapter: ProviderAdapter) {
    // A crash can leave threads marked running; nothing is running after a restart.
    for (const t of store.listThreads()) if (t.status === 'running') store.writeMeta({ ...t, status: 'idle' });
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
      case 'create_thread':
        return this.create(c, msg.cwd, msg.title);
      case 'subscribe':
        return this.subscribe(c, msg.threadId, msg.lastSeq);
      case 'send':
        return void this.send(c, msg.threadId, msg.text);
      case 'interrupt':
        return void this.sessions.get(msg.threadId)?.interrupt();
      case 'set_mode':
        return this.setMode(msg.threadId, msg.mode);
      case 'respond':
        return this.sessions.get(msg.threadId)?.respond(msg.requestId, msg.decision as Decision);
    }
  }

  private create(c: Client, cwd: string, title?: string) {
    try {
      if (!statSync(cwd).isDirectory()) throw new Error('not a directory');
    } catch {
      return c.send({ type: 'error', message: `Folder not found: ${cwd}` });
    }
    const now = Date.now();
    const meta: ThreadMeta = { id: randomUUID(), title: title?.trim() || 'New chat', cwd, provider: 'claude', status: 'idle', createdAt: now, updatedAt: now };
    this.store.writeMeta(meta);
    this.broadcastAll({ type: 'thread_updated', thread: meta });
  }

  private subscribe(c: Client, threadId: string, lastSeq: number) {
    if (!this.store.readMeta(threadId)) return c.send({ type: 'error', message: 'Unknown thread' });
    c.subs.add(threadId);
    for (const event of this.store.readEvents(threadId, lastSeq)) c.send({ type: 'event', event });
    c.send({ type: 'replay_done', threadId, lastSeq: this.store.readEvents(threadId).at(-1)?.seq ?? 0 });
  }

  private async send(c: Client, threadId: string, text: string) {
    const meta = this.store.readMeta(threadId);
    if (!meta) return c.send({ type: 'error', message: 'Unknown thread' });
    if (!text.trim()) return;
    if (meta.status === 'running') return c.send({ type: 'error', message: 'A turn is already running. Stop it first.' });
    const title = meta.title === 'New chat' ? text.trim().replace(/\s+/g, ' ').slice(0, 60) : meta.title;
    this.update(meta, { title, status: 'running' });
    this.emit(threadId, { type: 'user_message', text });
    try {
      await this.session(threadId).send(text);
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
