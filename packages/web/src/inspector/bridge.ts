// Talks to the page agent inside the preview iframe (protocol: packages/server/assets/agent.js header) and holds
// the inspector's state. This is the one selection layer; comments can reuse `select`/`el` later instead of forking it.
import { useSyncExternalStore } from 'react';
import { buildEditsReport, countChanges, type EditEntry, type ReportContext } from '@designer/shared';
import type { Props, Selected } from './model';

export interface InspectorState {
  /** The user turned Inspect on. */
  on: boolean;
  /** The page's agent answered, so selection and edits work. */
  connected: boolean;
  el: Selected | null;
  edits: EditEntry[];
  /** What is being previewed (file path or page address), for the report. */
  target: string;
}

export interface Frame {
  win: Window;
  /** The frame's origin: where messages are sent and the only origin accepted back. */
  origin: string;
}

interface Incoming {
  source: unknown;
  origin: string;
  data: unknown;
}

/**
 * Whether a message event may be believed. It must come from the preview frame's own window at its origin, be tagged
 * for Designer, and carry this session's nonce (so a message forged by the page without having seen our hello is dropped).
 */
export function accept(e: Incoming, frame: Frame | null, nonce: string): Record<string, unknown> | null {
  if (!frame || e.source !== frame.win || e.origin !== frame.origin) return null;
  const d = e.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object' || d.designer !== 1 || d.nonce !== nonce) return null;
  return d;
}


class Inspector {
  state: InspectorState = { on: false, connected: false, el: null, edits: [], target: '' };
  private listeners = new Set<() => void>();
  private frame: Frame | null = null;
  private nonce = '';
  private listening = false;

  subscribe = (l: () => void) => (this.listeners.add(l), () => this.listeners.delete(l));
  getSnapshot = () => this.state;
  private set(p: Partial<InspectorState>) {
    this.state = { ...this.state, ...p };
    this.listeners.forEach((l) => l());
  }

  private send(m: Record<string, unknown>) {
    if (this.frame) this.frame.win.postMessage({ ...m, designer: 1 }, this.frame.origin);
  }

  private listen() {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener('message', (e) => {
      const d = accept(e, this.frame, this.nonce);
      if (d) this.onMessage(d);
    });
  }

  /** A (new) document loaded in the preview frame: say hello, and turn selection on if Inspect is on. */
  attach(win: Window | null, origin: string) {
    this.listen();
    this.frame = win && origin ? { win, origin } : null;
    this.nonce = this.frame ? crypto.randomUUID() : '';
    this.set({ connected: false, el: null, edits: [] }); // a new document starts without edits
    this.send({ type: 'hello', nonce: this.nonce });
  }
  detach() {
    this.frame = null;
    this.nonce = '';
    this.set({ connected: false, el: null, edits: [] });
  }

  private onMessage(d: Record<string, unknown>) {
    switch (d.type) {
      case 'ready':
        this.set({ connected: true });
        if (this.state.on) this.send({ type: 'enable', on: true });
        break;
      case 'selected':
        this.set({ el: d.el as Selected });
        break;
      case 'deselected':
        this.set({ el: null });
        break;
      case 'log':
        this.set({ edits: ((d.edits as EditEntry[]) ?? []).filter((x) => x.changes.length) });
        break;
    }
  }

  setTarget(target: string) {
    if (target !== this.state.target) this.set({ target });
  }

  setOn(on: boolean) {
    if (on === this.state.on) return;
    this.set({ on, ...(on ? {} : { el: null }) });
    if (this.state.connected) this.send({ type: 'enable', on });
  }

  select(id: string) {
    this.send({ type: 'select', id });
  }
  deselect() {
    this.send({ type: 'deselect' });
  }
  /** Apply style properties to the selected element (null/'' removes an edit). */
  apply(props: Props, id = this.state.el?.id) {
    if (id) this.send({ type: 'apply', id, props });
  }
  /** Move to a page position (per axis). The page works it out from the element's current position. */
  place(pos: { x?: number; y?: number }, id = this.state.el?.id) {
    if (id) this.send({ type: 'place', id, ...pos });
  }
  /** Set the rendered size (per dimension), measured against the element as it is now. */
  size(dim: { w?: number; h?: number }, id = this.state.el?.id) {
    if (id) this.send({ type: 'size', id, ...dim });
  }
  reset(id?: string) {
    this.send({ type: 'reset', ...(id ? { id } : {}) });
  }

  get pending() {
    return countChanges(this.state.edits);
  }
  report(ctx: ReportContext = {}) {
    return buildEditsReport(this.state.edits, ctx);
  }
}

export const inspector = new Inspector();
export const useInspector = <T,>(sel: (s: InspectorState) => T): T => sel(useSyncExternalStore(inspector.subscribe, inspector.getSnapshot));
export const useChangeCount = () => useInspector((s) => countChanges(s.edits));
