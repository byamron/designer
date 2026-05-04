/**
 * Roadmap canvas store (Phase 22.A).
 *
 * One store per project — keyed by `ProjectId`. Wraps the IPC view with
 * three concerns:
 *
 * 1. **Per-node selectors via `useSyncExternalStore`.** Listeners
 *    subscribe to a single `NodeId` and only re-render when *that* node's
 *    derived status, claims, or shipments change.
 * 2. **Microtask coalescing.** When multiple updates arrive in the same
 *    tick (e.g., a burst of `track_started` events from the bridge), we
 *    flush once via `queueMicrotask` so React renders once per microtask
 *    instead of once per event. `requestAnimationFrame` was rejected —
 *    16 ms latency violates the spec's "<16 ms presence updates" budget.
 * 3. **Snapshot stability.** `useSyncExternalStore` requires referential
 *    stability between snapshots when nothing changed; the store memoizes
 *    per-node slices via a WeakMap so React's bailout works.
 */

import { useSyncExternalStore } from "react";
import type {
  NodeClaim,
  NodeId,
  NodeShipment,
  NodeStatus,
  NodeView,
  RoadmapView,
} from "../ipc/client";
import type { ProjectId } from "../ipc/types";

export interface NodeSlice {
  node: NodeView | null;
  claims: NodeClaim[];
  shipments: NodeShipment[];
  derivedStatus: NodeStatus | null;
}

const EMPTY_NODE_SLICE: NodeSlice = {
  node: null,
  claims: [],
  shipments: [],
  derivedStatus: null,
};

type Listener = () => void;

class RoadmapStore {
  private view: RoadmapView | null = null;
  private listeners = new Set<Listener>();
  private nodeListeners = new Map<NodeId, Set<Listener>>();
  /** Pending dirty set — node ids whose subscribers should fire on the next flush. */
  private pendingNodes: Set<NodeId> = new Set();
  private pendingGlobal = false;
  private flushScheduled = false;
  /** Slice cache — referentially stable per-node snapshots until the slice changes. */
  private sliceCache = new Map<NodeId, NodeSlice>();

  getView(): RoadmapView | null {
    return this.view;
  }

  setView(next: RoadmapView | null) {
    if (this.view === next) return;
    const prev = this.view;
    this.view = next;
    // Invalidate slice cache for nodes whose data changed.
    if (prev?.tree) {
      for (const node of prev.tree.nodes) {
        this.pendingNodes.add(node.id);
      }
    }
    if (next?.tree) {
      for (const node of next.tree.nodes) {
        this.pendingNodes.add(node.id);
      }
    }
    this.sliceCache.clear();
    this.pendingGlobal = true;
    this.scheduleFlush();
  }

  /**
   * Mark one node dirty without replacing the whole view — used by the
   * presence bridge so a single TrackStarted doesn't churn unrelated rows.
   * Phase 22.A doesn't wire incremental updates yet (full refetch is
   * cheap), but the API is here so 22.D / 22.I can plug in cleanly.
   */
  invalidateNode(nodeId: NodeId) {
    this.pendingNodes.add(nodeId);
    this.sliceCache.delete(nodeId);
    this.scheduleFlush();
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeNode(nodeId: NodeId, listener: Listener): () => void {
    let set = this.nodeListeners.get(nodeId);
    if (!set) {
      set = new Set();
      this.nodeListeners.set(nodeId, set);
    }
    set.add(listener);
    return () => {
      const s = this.nodeListeners.get(nodeId);
      if (!s) return;
      s.delete(listener);
      if (s.size === 0) this.nodeListeners.delete(nodeId);
    };
  }

  /** Stable per-node slice, memoized until the underlying data changes. */
  selectNode(nodeId: NodeId): NodeSlice {
    const cached = this.sliceCache.get(nodeId);
    if (cached) return cached;
    if (!this.view || !this.view.tree) {
      this.sliceCache.set(nodeId, EMPTY_NODE_SLICE);
      return EMPTY_NODE_SLICE;
    }
    const node = this.view.tree.nodes.find((n) => n.id === nodeId) ?? null;
    const claims =
      this.view.claims.find((c) => c.node_id === nodeId)?.claims ?? [];
    const shipments =
      this.view.shipments.find((s) => s.node_id === nodeId)?.shipments ?? [];
    const slice: NodeSlice = {
      node,
      claims,
      shipments,
      derivedStatus: node?.derived_status ?? null,
    };
    this.sliceCache.set(nodeId, slice);
    return slice;
  }

  private scheduleFlush() {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    queueMicrotask(() => {
      this.flushScheduled = false;
      const dirtyNodes = this.pendingNodes;
      const wasGlobal = this.pendingGlobal;
      this.pendingNodes = new Set();
      this.pendingGlobal = false;
      if (wasGlobal) {
        for (const l of this.listeners) l();
      }
      for (const id of dirtyNodes) {
        const set = this.nodeListeners.get(id);
        if (!set) continue;
        for (const l of set) l();
      }
    });
  }
}

const stores = new Map<ProjectId, RoadmapStore>();

export function getRoadmapStore(projectId: ProjectId): RoadmapStore {
  let s = stores.get(projectId);
  if (!s) {
    s = new RoadmapStore();
    stores.set(projectId, s);
  }
  return s;
}

/** React hook: subscribe to the whole view. */
export function useRoadmapView(projectId: ProjectId): RoadmapView | null {
  const store = getRoadmapStore(projectId);
  return useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.getView(),
    () => store.getView(),
  );
}

/** React hook: subscribe to a single node's slice. */
export function useRoadmapNode(
  projectId: ProjectId,
  nodeId: NodeId,
): NodeSlice {
  const store = getRoadmapStore(projectId);
  return useSyncExternalStore(
    (l) => store.subscribeNode(nodeId, l),
    () => store.selectNode(nodeId),
    () => store.selectNode(nodeId),
  );
}

export type { RoadmapStore };
