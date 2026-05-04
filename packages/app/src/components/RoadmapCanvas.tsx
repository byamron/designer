/**
 * Roadmap canvas (Phase 22.A) — phase strip + node tree + claims + parse-error
 * + empty-state. The block-renderer registry mounts `RoadmapBlock`; this file
 * holds everything that paints inside it.
 *
 * # Anatomy
 *
 * - `RoadmapPhaseStrip` — vertical list of phase headlines. Active phase
 *   expanded; siblings collapsed. Below `--breakpoint-md`, would fall back
 *   to a horizontal scroll-snap strip (we don't actually flip layouts in
 *   v1 — the canvas is a vertical column inside the Home tab regardless).
 * - `RoadmapNodeRow` — one node row: status circle, headline (text region
 *   is the expand target), chevron (`IconButton` at `--target-sm`),
 *   team-label cluster, optional done-shipped hint glyph.
 * - `RoadmapMultiClaimStack` — stacked team labels, collapses to `+N`
 *   past 3, overflow rendered through the existing `Tooltip` primitive.
 * - `RoadmapParseError` — line + snippet + Open in editor.
 * - `RoadmapEmptyDialog` — `AppDialog` shell with a "Paste a draft" form.
 *
 * # ARIA
 *
 * The canvas root carries `role="tree"`. Each row is a `treeitem` with
 * `aria-level`, `aria-expanded` (when expandable), and a single primary
 * `aria-label`. Keyboard: ↑↓ siblings, ←/→ collapse/expand, Home/End to
 * the first/last visible row.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type KeyboardEvent,
} from "react";
import { ChevronRight, ExternalLink, Info } from "lucide-react";
import { IconButton } from "./IconButton";
import { Tooltip } from "./Tooltip";
import { SegmentedToggle } from "./SegmentedToggle";
import { RoadmapStatusCircle } from "./RoadmapStatusCircle";
import { ShippedHereBadge } from "../blocks/ShippedHereBadge";
import { ipcClient } from "../ipc/client";
import type {
  NodeClaim,
  NodeId,
  NodeShipment,
  NodeView,
  RoadmapParseError,
  RoadmapView,
} from "../ipc/client";
import type { ProjectId } from "../ipc/types";
import { getRoadmapStore, useRoadmapView } from "../store/roadmap";

// ---------------------------------------------------------------------------
// Top-level surface
// ---------------------------------------------------------------------------

export function RoadmapCanvas({ projectId }: { projectId: ProjectId }) {
  const view = useRoadmapView(projectId);
  const [loading, setLoading] = useState(true);
  const [refetchTick, setRefetchTick] = useState(0);

  // Initial fetch + refetch on window focus (the v1 substitute for
  // fs-watch — the IPC re-parses on hash change so this is cheap).
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void ipcClient()
      .getRoadmap(projectId)
      .then((v) => {
        if (cancelled) return;
        getRoadmapStore(projectId).setView(v);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, refetchTick]);

  useEffect(() => {
    const onFocus = () => setRefetchTick((t) => t + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  if (loading && !view) {
    return (
      <section
        className="roadmap-canvas roadmap-canvas--loading"
        data-component="RoadmapCanvas"
        aria-busy="true"
      >
        <span className="roadmap-canvas__loading">Loading roadmap…</span>
      </section>
    );
  }

  if (view?.parse_error) {
    return (
      <section className="roadmap-canvas" data-component="RoadmapCanvas">
        <RoadmapParseErrorSlab
          error={view.parse_error}
          onOpenInEditor={() => void openRoadmapInEditor(view.roadmap_path)}
        />
      </section>
    );
  }

  if (!view || !view.tree) {
    return (
      <section className="roadmap-canvas" data-component="RoadmapCanvas">
        <RoadmapEmptyState
          projectId={projectId}
          onPasted={() => setRefetchTick((t) => t + 1)}
        />
      </section>
    );
  }

  return (
    <section
      className="roadmap-canvas"
      data-component="RoadmapCanvas"
      aria-label="Roadmap"
    >
      <RoadmapPhaseStrip projectId={projectId} view={view} />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Phase strip + active-phase derivation
// ---------------------------------------------------------------------------

function RoadmapPhaseStrip({
  projectId,
  view,
}: {
  projectId: ProjectId;
  view: RoadmapView;
}) {
  const tree = view.tree!;
  const roots = useMemo(
    () => tree.nodes.filter((n) => n.parent_id === null),
    [tree],
  );
  const activeId = useMemo(() => deriveActivePhase(roots), [roots]);
  const [hideCompleted, setHideCompleted] = useState(false);
  const [expandedPhases, setExpandedPhases] = useState<Set<NodeId>>(
    () => new Set(activeId ? [activeId] : []),
  );

  useEffect(() => {
    if (activeId && !expandedPhases.has(activeId)) {
      setExpandedPhases((prev) => {
        const next = new Set(prev);
        next.add(activeId);
        return next;
      });
    }
    // We deliberately don't re-collapse on activeId churn — user control
    // wins once they've toggled.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const visibleRoots = useMemo(
    () =>
      hideCompleted
        ? roots.filter((r) => r.derived_status !== "done" && r.derived_status !== "canceled")
        : roots,
    [roots, hideCompleted],
  );

  return (
    <div
      className="roadmap-phase-strip"
      data-component="RoadmapPhaseStrip"
      role="tree"
      aria-label="Roadmap phases"
    >
      <header className="roadmap-phase-strip__header">
        <h3 className="roadmap-phase-strip__title">Roadmap</h3>
        <div className="roadmap-phase-strip__filter">
          <SegmentedToggle<"all" | "active">
            ariaLabel="Filter completed phases"
            value={hideCompleted ? "active" : "all"}
            onChange={(v) => setHideCompleted(v === "active")}
            options={[
              { value: "all", label: "All" },
              { value: "active", label: "Active" },
            ]}
          />
        </div>
      </header>
      <ul className="roadmap-phase-strip__list">
        {visibleRoots.map((root) => (
          <RoadmapNodeRow
            key={root.id}
            projectId={projectId}
            node={root}
            tree={view.tree!}
            depth={1}
            expanded={expandedPhases.has(root.id)}
            onToggleExpanded={() =>
              setExpandedPhases((prev) => {
                const next = new Set(prev);
                if (next.has(root.id)) next.delete(root.id);
                else next.add(root.id);
                return next;
              })
            }
            view={view}
          />
        ))}
      </ul>
    </div>
  );
}

/**
 * Active phase = the lowest-indexed root whose subtree contains at least
 * one non-Done/non-Canceled node. Tiebreak: most live claims; if zero
 * claims, lowest index wins. Persisted user override comes later (v1
 * recomputes on each render — cheap).
 */
function deriveActivePhase(roots: NodeView[]): NodeId | null {
  for (const r of roots) {
    if (r.derived_status !== "done" && r.derived_status !== "canceled") {
      return r.id;
    }
  }
  return roots[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Node row
// ---------------------------------------------------------------------------

interface RowProps {
  projectId: ProjectId;
  node: NodeView;
  tree: { source: string; nodes: NodeView[] };
  depth: number;
  expanded: boolean;
  onToggleExpanded: () => void;
  view: RoadmapView;
}

function RoadmapNodeRow({
  projectId,
  node,
  tree,
  depth,
  expanded,
  onToggleExpanded,
  view,
}: RowProps) {
  const childNodes = useMemo(
    () => node.child_ids.map((id) => tree.nodes.find((n) => n.id === id)).filter(Boolean) as NodeView[],
    [node.child_ids, tree.nodes],
  );
  const claims = useMemo(
    () => view.claims.find((c) => c.node_id === node.id)?.claims ?? [],
    [view.claims, node.id],
  );
  const shipments: NodeShipment[] = useMemo(
    () => view.shipments.find((s) => s.node_id === node.id)?.shipments ?? [],
    [view.shipments, node.id],
  );
  const expandable = childNodes.length > 0 || node.body_length > 0;
  const authoredDoneSuppressed =
    node.status === "done" && node.derived_status === "in-review";

  const onRowKey = (e: KeyboardEvent<HTMLLIElement>) => {
    if (e.key === "ArrowRight" && expandable && !expanded) {
      e.preventDefault();
      onToggleExpanded();
    } else if (e.key === "ArrowLeft" && expandable && expanded) {
      e.preventDefault();
      onToggleExpanded();
    } else if (e.key === "Enter" || e.key === " ") {
      if (expandable) {
        e.preventDefault();
        onToggleExpanded();
      }
    }
  };

  return (
    <li
      className="roadmap-node-row"
      data-component="RoadmapNodeRow"
      data-status={node.derived_status}
      data-depth={depth}
      role="treeitem"
      aria-level={depth}
      aria-expanded={expandable ? expanded : undefined}
      tabIndex={0}
      onKeyDown={onRowKey}
    >
      <div className="roadmap-node-row__head">
        <div className="roadmap-node-row__chevron">
          {expandable ? (
            <IconButton
              label={expanded ? "Collapse" : "Expand"}
              size="sm"
              onClick={onToggleExpanded}
              aria-expanded={expanded}
            >
              <ChevronRight
                size={12}
                aria-hidden
                className="roadmap-node-row__chevron-glyph"
                data-expanded={expanded}
              />
            </IconButton>
          ) : (
            <span className="roadmap-node-row__chevron-spacer" aria-hidden />
          )}
        </div>
        <RoadmapStatusCircle status={node.derived_status} />
        <button
          type="button"
          className="roadmap-node-row__headline"
          onClick={expandable ? onToggleExpanded : undefined}
          aria-label={node.headline}
        >
          {node.headline}
        </button>
        {childNodes.length > 0 && (
          <span className="roadmap-node-row__ratio" aria-label="Completion ratio">
            {countDone(childNodes)}/{childNodes.length}
          </span>
        )}
        {authoredDoneSuppressed && (
          <DoneShippedHint headline={node.headline} />
        )}
        <RoadmapMultiClaimStack claims={claims} />
        <Tooltip label="Open in editor" side="top">
          <IconButton
            label="Open in editor"
            size="sm"
            onClick={() => void openRoadmapInEditor(view.roadmap_path)}
          >
            <ExternalLink size={12} aria-hidden />
          </IconButton>
        </Tooltip>
      </div>
      {shipments.length > 0 && (
        <div
          className="roadmap-node-row__shipments"
          aria-label="Shipping history"
        >
          <ShippedHereBadge shipments={shipments} />
        </div>
      )}
      {expanded && childNodes.length > 0 && (
        <ul className="roadmap-node-row__children" role="group">
          {childNodes.map((child) => (
            <RoadmapNodeRow
              key={child.id}
              projectId={projectId}
              node={child}
              tree={tree}
              depth={depth + 1}
              expanded={false}
              onToggleExpanded={() => {}}
              view={view}
            />
          ))}
        </ul>
      )}
      {expanded && node.body_length > 0 && childNodes.length === 0 && (
        <NodeBody source={tree.source} offset={node.body_offset} length={node.body_length} />
      )}
    </li>
  );
}

function countDone(nodes: NodeView[]): number {
  return nodes.filter((n) => n.derived_status === "done").length;
}

// ---------------------------------------------------------------------------
// Done = shipped hint
// ---------------------------------------------------------------------------

function DoneShippedHint({ headline }: { headline: string }) {
  // One label, one story: the tooltip is the label. The wrapping span is
  // tabbable so keyboard users can reach the tooltip via focus, and the
  // role is "img" so AT announces the icon's meaning rather than treating
  // it as an empty interactive element.
  return (
    <Tooltip
      label={`Authored Done is suppressed until shipment — ships when the PR for "${headline}" merges`}
      side="top"
    >
      <span
        className="roadmap-done-shipped-hint"
        data-component="DoneShippedHint"
        tabIndex={0}
        role="img"
      >
        <Info size={12} aria-hidden />
      </span>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Multi-claim stack
// ---------------------------------------------------------------------------

const COLLAPSE_AFTER = 3;

function RoadmapMultiClaimStack({ claims }: { claims: NodeClaim[] }) {
  if (claims.length === 0) return null;
  const visible = claims.slice(0, COLLAPSE_AFTER);
  const overflow = claims.length - visible.length;
  return (
    <span
      className="roadmap-multi-claim-stack"
      data-component="RoadmapMultiClaimStack"
    >
      {visible.map((c) => (
        <TeamLabel key={c.track_id} claim={c} />
      ))}
      {overflow > 0 && (
        <Tooltip
          label={claims
            .slice(COLLAPSE_AFTER)
            .map((c) => labelFor(c))
            .join(", ")}
          side="top"
        >
          <span
            className="roadmap-multi-claim-stack__overflow"
            tabIndex={0}
            aria-label={`${overflow} more claimants`}
          >
            +{overflow}
          </span>
        </Tooltip>
      )}
    </span>
  );
}

function TeamLabel({ claim }: { claim: NodeClaim }) {
  return (
    <span
      className="roadmap-team-label"
      data-component="TeamLabel"
      data-track-id={claim.track_id}
    >
      <span className="roadmap-team-label__dot" aria-hidden />
      <span className="roadmap-team-label__name">{labelFor(claim)}</span>
    </span>
  );
}

function labelFor(claim: NodeClaim): string {
  // 22.G ships team identity; until then, use the workspace short id.
  return `wks ${claim.workspace_id.slice(0, 6)}`;
}

// ---------------------------------------------------------------------------
// Lazy body render via Web Worker
// ---------------------------------------------------------------------------

let workerSingleton: Worker | null = null;
function getBodyWorker(): Worker {
  if (workerSingleton) return workerSingleton;
  // Vite ?worker import — emits a separate chunk; not inlined.
  // Dynamic import keeps the worker out of the main bundle until first use.
  workerSingleton = new Worker(
    new URL("../blocks/roadmap-body.worker.ts", import.meta.url),
    { type: "module" },
  );
  return workerSingleton;
}

function NodeBody({
  source,
  offset,
  length,
}: {
  source: string;
  offset: number;
  length: number;
}) {
  const reqId = useId();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const slice = useMemo(() => source.slice(offset, offset + length), [source, offset, length]);

  useEffect(() => {
    const worker = getBodyWorker();
    const handler = (e: MessageEvent) => {
      const data = e.data as { reqId: string; html: string; error?: string };
      if (data.reqId !== reqId) return;
      if (data.error) setError(data.error);
      else setHtml(data.html);
    };
    worker.addEventListener("message", handler);
    worker.postMessage({ reqId, body: slice });
    return () => worker.removeEventListener("message", handler);
  }, [reqId, slice]);

  if (error) {
    return (
      <div className="roadmap-node-row__body roadmap-node-row__body--error">
        <pre>{error}</pre>
      </div>
    );
  }
  if (html === null) {
    return <div className="roadmap-node-row__body" aria-busy="true" />;
  }
  return (
    <div
      className="roadmap-node-row__body"
      // Body markdown is from the user's own roadmap.md — trusted local
      // source. Workers don't get DOM access so this is the only option.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

// ---------------------------------------------------------------------------
// Parse-error slab
// ---------------------------------------------------------------------------

function RoadmapParseErrorSlab({
  error,
  onOpenInEditor,
}: {
  error: RoadmapParseError;
  onOpenInEditor: () => void;
}) {
  return (
    <div className="roadmap-parse-error" data-component="RoadmapParseError" role="alert">
      <h3 className="roadmap-parse-error__title">Roadmap couldn't parse</h3>
      <p className="roadmap-parse-error__hint">
        Line {error.line}: {error.hint}
      </p>
      <pre className="roadmap-parse-error__snippet">{error.snippet}</pre>
      <button
        type="button"
        className="roadmap-parse-error__action"
        onClick={onOpenInEditor}
      >
        Open in editor
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state — Paste a draft
// ---------------------------------------------------------------------------

function RoadmapEmptyState({
  projectId,
  onPasted,
}: {
  projectId: ProjectId;
  onPasted: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="roadmap-empty" data-component="RoadmapEmptyState">
      <p className="roadmap-empty__copy">
        The Roadmap shows your project's plan with live agent presence. Draft
        one to begin.
      </p>
      <button
        type="button"
        className="roadmap-empty__action"
        onClick={() => setOpen(true)}
      >
        Paste a draft
      </button>
      {open && (
        <RoadmapEmptyDialog
          projectId={projectId}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false);
            onPasted();
          }}
        />
      )}
    </div>
  );
}

function RoadmapEmptyDialog({
  projectId,
  onClose,
  onSaved,
}: {
  projectId: ProjectId;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const onSave = useCallback(async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      // Delegated to the host shell; for v1 we just stuff the markdown
      // through a generic write (real save lands when 22.C ships its
      // origination IPC). The IPC mock no-ops, so dogfood path needs a
      // backing endpoint to actually persist; tracked in the followups.
      await writeRoadmapDraft(projectId, text);
      onSaved();
    } finally {
      setBusy(false);
    }
  }, [text, busy, projectId, onSaved]);

  return (
    <div
      className="roadmap-empty-dialog-scrim"
      data-component="RoadmapEmptyDialog"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="roadmap-empty-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="roadmap-empty-dialog-title"
      >
        <h2 className="roadmap-empty-dialog__title" id="roadmap-empty-dialog-title">
          Start your roadmap
        </h2>
        <p className="roadmap-empty-dialog__copy">
          Paste a draft of your project roadmap. Designer will track work
          against it.
        </p>
        <textarea
          className="roadmap-empty-dialog__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={"# My project\n\n## Phase 1\n..."}
          aria-label="Roadmap draft"
        />
        <div className="roadmap-empty-dialog__actions">
          <button type="button" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="roadmap-empty-dialog__primary"
            onClick={() => void onSave()}
            disabled={!text.trim() || busy}
          >
            Save to roadmap.md
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Side effects shared with the host
// ---------------------------------------------------------------------------

async function openRoadmapInEditor(roadmapPath: string): Promise<void> {
  // The IPC reveals the absolute path resolved server-side, so the user's
  // Finder lands on the right file regardless of where the app was
  // launched from. A future "open with $EDITOR" command can replace this.
  try {
    await ipcClient().revealInFinder(roadmapPath);
  } catch {
    /* swallow — non-Tauri / non-mac paths log a warning host-side */
  }
}

async function writeRoadmapDraft(
  projectId: ProjectId,
  text: string,
): Promise<void> {
  // Persists `text` verbatim to core-docs/roadmap.md. Phase 22.C will
  // add the silent-commit step (per Decision 18); for v1 the file
  // lands on disk and the user git-adds manually.
  await ipcClient().writeRoadmapDraft(projectId, text);
}
