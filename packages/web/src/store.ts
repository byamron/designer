import { useSyncExternalStore } from 'react';
import type { ClientMsg, Decision, PermissionMode, ServerMsg, StoredEvent, ThreadMeta, ToolStatus, Workspace } from '@designer/shared';

export type Item =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; streaming: boolean }
  | { kind: 'tool'; id: string; name: string; toolKind: string; label: string; status: ToolStatus; output?: string }
  | { kind: 'approval'; id: string; toolName: string; label: string; resolved?: Decision }
  | { kind: 'error'; id: string; message: string }
  | { kind: 'done'; id: string; costUsd?: number; interrupted?: boolean; ms?: number };

export interface ThreadView {
  items: Item[];
  lastSeq: number;
  loaded: boolean;
  queue: string[];
  /** Count of finished turns seen, used to refresh previews. */
  turns: number;
  /** Timestamp of the latest user message: when the current (or last) turn began. */
  turnStart?: number;
}

export interface State {
  connected: boolean;
  defaultCwd: string;
  previewPort?: number;
  /** Text the user selected in a reply to quote in the next message. */
  quote?: { threadId: string; text: string; n: number };
  workspaces: Workspace[];
  threads: ThreadMeta[];
  activeId?: string;
  views: Record<string, ThreadView>;
  notice?: string;
}

const emptyView = (): ThreadView => ({ items: [], lastSeq: 0, loaded: false, queue: [], turns: 0 });

function applyEvent(items: Item[], e: StoredEvent, turnStart?: number): Item[] {
  const upsert = (it: Item) => {
    const i = items.findIndex((x) => x.id === it.id && x.kind === it.kind);
    if (i < 0) return [...items, it];
    const next = items.slice();
    next[i] = it;
    return next;
  };
  switch (e.type) {
    case 'user_message': return [...items, { kind: 'user', id: `u${e.seq}`, text: e.text }];
    case 'assistant_message': return upsert({ kind: 'assistant', id: e.messageId, text: e.text, streaming: false });
    case 'tool_call': return upsert({ kind: 'tool', id: e.id, name: e.name, toolKind: e.kind, label: e.label, status: e.status, output: e.output });
    case 'approval_request': return upsert({ kind: 'approval', id: e.requestId, toolName: e.toolName, label: e.label });
    case 'approval_resolved': return items.map((x) => (x.kind === 'approval' && x.id === e.requestId ? { ...x, resolved: e.decision } : x));
    case 'error': return [...items, { kind: 'error', id: `e${e.seq}`, message: e.message }];
    case 'turn_done':
      return [
        ...items.map((x) => (x.kind === 'assistant' && x.streaming ? { ...x, streaming: false } : x)),
        { kind: 'done', id: `d${e.seq}`, costUsd: e.costUsd, interrupted: e.interrupted, ms: turnStart ? e.ts - turnStart : undefined },
      ];
  }
}

class Store {
  state: State = { connected: false, defaultCwd: '', workspaces: [], threads: [], views: {} };
  private listeners = new Set<() => void>();
  private ws?: WebSocket;
  private retry = 0;
  private deltas = new Map<string, string>(); // `${threadId}|${messageId}` -> text
  private raf = 0;

  subscribe = (l: () => void) => (this.listeners.add(l), () => this.listeners.delete(l));
  getSnapshot = () => this.state;
  private set(patch: Partial<State>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  private setView(id: string, fn: (v: ThreadView) => ThreadView) {
    const v = this.state.views[id] ?? emptyView();
    this.set({ views: { ...this.state.views, [id]: fn(v) } });
  }

  connect() {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
    this.ws = ws;
    ws.onopen = () => {
      this.retry = 0;
      this.set({ connected: true, notice: undefined });
      const id = this.state.activeId;
      if (id) this.send({ type: 'subscribe', threadId: id, lastSeq: this.state.views[id]?.lastSeq ?? 0 });
    };
    ws.onmessage = (m) => this.onMsg(JSON.parse(m.data) as ServerMsg);
    ws.onclose = () => {
      this.set({ connected: false });
      setTimeout(() => this.connect(), Math.min(5000, 300 * 2 ** this.retry++));
    };
  }

  send(m: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  private onMsg(m: ServerMsg) {
    switch (m.type) {
      case 'hello': return this.set({ defaultCwd: m.defaultCwd, previewPort: m.previewPort });
      case 'workspaces': return this.set({ workspaces: m.workspaces });
      case 'workspace_updated': {
        this.set({ workspaces: [...this.state.workspaces.filter((w) => w.id !== m.workspace.id), m.workspace] });
        // adding a folder that already has sessions just opens one of them
        const existing = this.pendingOpen && this.state.threads.find((t) => t.workspaceId === m.workspace.id && !t.archived);
        if (existing) {
          this.pendingOpen = false;
          this.open(existing.id);
        }
        return;
      }
      case 'workspace_removed': return this.set({ workspaces: this.state.workspaces.filter((w) => w.id !== m.workspaceId) });
      case 'threads': {
        this.set({ threads: m.threads });
        if (!this.state.activeId) {
          const last = this.recall();
          const t = m.threads.find((x) => x.id === last && !x.archived);
          if (t) this.open(t.id);
        }
        return;
      }
      case 'thread_updated': {
        const rest = this.state.threads.filter((t) => t.id !== m.thread.id);
        const isNew = rest.length === this.state.threads.length;
        this.set({ threads: [m.thread, ...rest].sort((a, b) => b.updatedAt - a.updatedAt) });
        if (isNew && this.pendingOpen) {
          this.pendingOpen = false;
          this.open(m.thread.id);
        }
        // closing the tab you are on moves you to a sibling session
        if (m.thread.archived && m.thread.id === this.state.activeId) {
          const live = this.state.threads.filter((t) => !t.archived);
          const sib = live.find((t) => t.workspaceId === m.thread.workspaceId) ?? live[0];
          if (sib) this.open(sib.id);
          else this.set({ activeId: undefined });
        }
        // a finished turn lets the next queued message go
        if (m.thread.status === 'idle') this.drainQueue(m.thread.id);
        return;
      }
      case 'event': {
        this.flushDeltas();
        const e = m.event;
        this.setView(e.threadId, (v) => (e.seq <= v.lastSeq ? v : { ...v, items: applyEvent(v.items, e, v.turnStart), turnStart: e.type === 'user_message' ? e.ts : v.turnStart, lastSeq: e.seq, turns: v.turns + (e.type === 'turn_done' && v.loaded ? 1 : 0) }));
        return;
      }
      case 'delta': {
        const k = `${m.delta.threadId}|${m.delta.messageId}`;
        this.deltas.set(k, (this.deltas.get(k) ?? '') + m.delta.text);
        this.raf ||= requestAnimationFrame(() => this.flushDeltas());
        return;
      }
      case 'replay_done': return this.setView(m.threadId, (v) => ({ ...v, loaded: true }));
      case 'error': return this.set({ notice: m.message });
    }
  }

  private flushDeltas() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.deltas.size) return;
    const byThread = new Map<string, Map<string, string>>();
    for (const [k, text] of this.deltas) {
      const [tid, mid] = k.split('|');
      if (!byThread.has(tid)) byThread.set(tid, new Map());
      byThread.get(tid)!.set(mid, text);
    }
    this.deltas.clear();
    const views = { ...this.state.views };
    for (const [tid, msgs] of byThread) {
      const v = views[tid] ?? emptyView();
      let items = v.items;
      for (const [mid, text] of msgs) {
        const i = items.findIndex((x) => x.kind === 'assistant' && x.id === mid);
        if (i < 0) items = [...items, { kind: 'assistant', id: mid, text, streaming: true }];
        else {
          const cur = items[i] as Extract<Item, { kind: 'assistant' }>;
          items = items.slice();
          items[i] = { ...cur, text: cur.text + text, streaming: true };
        }
      }
      views[tid] = { ...v, items };
    }
    this.set({ views });
  }

  private pendingOpen = false;
  addFolder(path: string) {
    this.pendingOpen = true;
    this.send({ type: 'add_folder', path });
  }
  createWorktree(fromWorkspaceId: string, name: string) {
    this.pendingOpen = true;
    this.send({ type: 'create_worktree', fromWorkspaceId, name });
  }
  newSession(workspaceId: string) {
    this.pendingOpen = true;
    this.send({ type: 'create_thread', workspaceId });
  }
  closeSession(threadId: string) {
    this.send({ type: 'archive_thread', threadId });
  }
  removeWorkspace(workspaceId: string) {
    this.send({ type: 'remove_workspace', workspaceId });
  }
  private recall() {
    try { return localStorage.getItem('designer.active') ?? undefined; } catch { return undefined; }
  }
  open(id: string) {
    this.set({ activeId: id, notice: undefined });
    try { localStorage.setItem('designer.active', id); } catch { /* private mode */ }
    this.send({ type: 'subscribe', threadId: id, lastSeq: this.state.views[id]?.lastSeq ?? 0 });
  }
  say(id: string, text: string) {
    const t = this.state.threads.find((x) => x.id === id);
    if (t?.status === 'running') this.setView(id, (v) => ({ ...v, queue: [...v.queue, text] }));
    else this.send({ type: 'send', threadId: id, text });
  }
  private drainQueue(id: string) {
    const v = this.state.views[id];
    if (!v?.queue.length) return;
    const [next, ...rest] = v.queue;
    this.setView(id, (x) => ({ ...x, queue: rest }));
    this.send({ type: 'send', threadId: id, text: next });
  }
  dropQueued(id: string, i: number) {
    this.setView(id, (v) => ({ ...v, queue: v.queue.filter((_, j) => j !== i) }));
  }
  quote(threadId: string, text: string) {
    this.set({ quote: { threadId, text, n: (this.state.quote?.n ?? 0) + 1 } });
  }
  clearQuote() {
    this.set({ quote: undefined });
  }
  interrupt(id: string) {
    this.send({ type: 'interrupt', threadId: id });
  }
  respond(id: string, requestId: string, decision: Decision) {
    this.send({ type: 'respond', threadId: id, requestId, decision });
  }
  setMode(id: string, mode: PermissionMode) {
    this.send({ type: 'set_mode', threadId: id, mode });
  }
}

export const store = new Store();
export const useStore = <T,>(sel: (s: State) => T): T => {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  return sel(snap);
};
