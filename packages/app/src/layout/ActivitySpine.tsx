import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Pin } from "lucide-react";
import {
  PANE_DEFAULT_WIDTH,
  commitSpineWidth,
  setFollowingAgent,
  setSpineWidthLive,
  toggleSpine,
  useAppState,
} from "../store/app";
import {
  latestActivityForStream,
  latestActivityForWorkspace,
  useDataState,
  useRecentActivity,
} from "../store/data";
import { ipcClient } from "../ipc/client";
import type { ArtifactSummary, SpineRow, StreamEvent } from "../ipc/types";
import { emptyArray } from "../util/empty";
import { humanizeKind } from "../util/humanize";
import { Tooltip } from "../components/Tooltip";
import { IconButton } from "../components/IconButton";
import { PaneResizer } from "../components/PaneResizer";
import { IconCollapseRight } from "../components/icons";

/**
 * Activity spine — strictly scoped to the selected workspace. Section
 * order, top-to-bottom:
 *
 *   1. Artifacts (specs, prototypes) — clicking opens as a new tab.
 *   2. Code files — placeholder until the file-index IPC lands.
 *   3. Agents — the live activity tree (following an agent still drives
 *      the main view through `setFollowingAgent`).
 *   4. Recent events — the last few stream events for this workspace.
 *
 * Previously the spine would fall back to project-level activity when no
 * workspace was selected. User feedback: that made the scope ambiguous.
 * Now if no workspace is active the spine renders a single empty state
 * asking the user to pick a workspace, and the four sections disappear.
 */
export function ActivitySpine() {
  const activeWorkspace = useAppState((s) => s.activeWorkspace);
  const spineWidth = useAppState((s) => s.spineWidth);
  const spine = useDataState<SpineRow[]>((s) =>
    activeWorkspace
      ? s.spines[`workspace:${activeWorkspace}`] ?? emptyArray()
      : emptyArray(),
  );
  const allEvents = useDataState<StreamEvent[]>((s) => s.events);

  const events = useMemo(() => {
    if (!activeWorkspace) return [];
    const scoped = allEvents.filter(
      (e) => e.stream_id === activeWorkspace || e.stream_id.startsWith(`${activeWorkspace}:`),
    );
    const sorted = [...scoped].sort(
      (a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp),
    );
    return sorted.slice(0, 6);
  }, [activeWorkspace, allEvents]);

  // Artifacts are driven by the real 13.1 projection, not the legacy spine
  // row pass-through. We re-fetch when the workspace changes or when a
  // stream event signals an artifact lifecycle change.
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const refreshArtifacts = useCallback(async () => {
    if (!activeWorkspace) {
      setArtifacts([]);
      return;
    }
    setArtifacts(await ipcClient().listArtifacts(activeWorkspace));
  }, [activeWorkspace]);
  useEffect(() => {
    void refreshArtifacts();
  }, [refreshArtifacts]);
  useEffect(() => {
    if (!activeWorkspace) return;
    const hasArtifactEvent = allEvents.some(
      (e) =>
        e.kind.startsWith("artifact_") &&
        (e.stream_id === activeWorkspace ||
          e.stream_id.startsWith(`${activeWorkspace}:`)),
    );
    if (hasArtifactEvent) void refreshArtifacts();
  }, [allEvents, activeWorkspace, refreshArtifacts]);

  const pinnedArtifacts = useMemo(
    () => artifacts.filter((a) => a.pinned),
    [artifacts],
  );
  const unpinnedArtifacts = useMemo(
    () => artifacts.filter((a) => !a.pinned),
    [artifacts],
  );

  const agentRows = useMemo(
    () => flattenSpine(filterOutArtifacts(spine)),
    [spine],
  );

  const summary = useMemo(() => {
    const activeCount = countState(spine, "active");
    const needsYou = countState(spine, "needs_you");
    const errored = countState(spine, "errored");
    return { activeCount, needsYou, errored };
  }, [spine]);

  const nothingStreaming =
    summary.activeCount + summary.needsYou + summary.errored === 0;

  // Summary dot pulses only while *any* stream scoped to the active
  // workspace is recently posting events. Without this gate the
  // summary header pulses forever after the first message — same
  // bug as the per-row pulse.
  const summaryLatestTs = useDataState((s) =>
    activeWorkspace
      ? latestActivityForWorkspace(s.recentActivityTs, activeWorkspace)
      : 0,
  );
  const summaryRecent = useRecentActivity(summaryLatestTs);

  const togglePin = useCallback(
    async (artifact: ArtifactSummary) => {
      await ipcClient().togglePinArtifact(artifact.id);
      void refreshArtifacts();
    },
    [refreshArtifacts],
  );

  // DP-B — chat references dispatch `designer:focus-artifact` when the user
  // clicks an inline `→ Spec: …` style reference. The spine listens, scrolls
  // the matching ArtifactRow into view, and applies a brief flash via
  // data-flash="true" (cleared after the animation runs). Keys the flash
  // by id so a second click on the same artifact re-arms the highlight.
  // The clear-timeout is tracked in a ref so rapid re-fires cancel the
  // pending clear (no piled-up timeouts), and unmount clears it too.
  const rowRefs = useRef(new Map<string, HTMLLIElement>());
  const flashTimerRef = useRef<number | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  useEffect(() => {
    const onFocus = (ev: Event) => {
      const id = (ev as CustomEvent<{ id?: string }>).detail?.id;
      if (!id) return;
      const row = rowRefs.current.get(id);
      if (!row) return;
      row.scrollIntoView({ behavior: "smooth", block: "nearest" });
      // Cancel any prior pending clear so the timer count stays at 1.
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
      // Re-arm by clearing first, then setting on the next frame.
      setFlashId(null);
      window.requestAnimationFrame(() => setFlashId(id));
      flashTimerRef.current = window.setTimeout(() => {
        setFlashId((prev) => (prev === id ? null : prev));
        flashTimerRef.current = null;
      }, 1200);
    };
    window.addEventListener("designer:focus-artifact", onFocus);
    return () => {
      window.removeEventListener("designer:focus-artifact", onFocus);
      if (flashTimerRef.current !== null) {
        window.clearTimeout(flashTimerRef.current);
        flashTimerRef.current = null;
      }
    };
  }, []);

  const setRowRef = useCallback((id: string, el: HTMLLIElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  return (
    <aside
      className="app-spine"
      data-component="ActivitySpine"
      aria-label="Activity"
      style={{ width: spineWidth }}
    >
      <PaneResizer
        side="left"
        width={spineWidth}
        onLiveChange={setSpineWidthLive}
        onCommit={commitSpineWidth}
        defaultWidth={PANE_DEFAULT_WIDTH}
        ariaLabel="Resize activity pane"
      />
      <header className="spine-header">
        <div className="spine-header__row">
          <strong className="sidebar-title">Workspace activity</strong>
          <IconButton
            label="Hide activity"
            shortcut="⌘]"
            onClick={() => toggleSpine(false)}
          >
            <IconCollapseRight />
          </IconButton>
        </div>
        {activeWorkspace && (
          <div className="spine-summary" aria-label="Activity summary">
            {summary.activeCount > 0 && (
              <span className="spine-summary__item">
                <span
                  className="state-dot"
                  data-state="active"
                  data-active-ts-recent={summaryRecent ? "true" : undefined}
                  aria-hidden="true"
                />
                {summary.activeCount} active
              </span>
            )}
            {summary.needsYou > 0 && (
              <span className="spine-summary__item">
                <span className="state-dot" data-state="needs_you" aria-hidden="true" />
                {summary.needsYou} need{summary.needsYou === 1 ? "s" : ""} you
              </span>
            )}
            {summary.errored > 0 && (
              <span className="spine-summary__item">
                <span className="state-dot" data-state="errored" aria-hidden="true" />
                {summary.errored} errored
              </span>
            )}
            {nothingStreaming && (
              <span className="spine-summary__item spine-summary__item--muted">
                <span className="state-dot" data-state="idle" aria-hidden="true" />
                Nothing streaming
              </span>
            )}
          </div>
        )}
      </header>

      {!activeWorkspace ? (
        <p className="sidebar-empty">Pick a workspace to see activity.</p>
      ) : (
        <>
          {pinnedArtifacts.length > 0 && (
            <div className="spine-section">
              <span className="sidebar-label">Pinned</span>
              <ul className="spine-items" role="list">
                {pinnedArtifacts.map((a) => (
                  <ArtifactRow
                    key={a.id}
                    artifact={a}
                    onTogglePin={() => void togglePin(a)}
                    flash={flashId === a.id}
                    setRowRef={setRowRef}
                  />
                ))}
              </ul>
            </div>
          )}

          <div className="spine-section">
            <span className="sidebar-label">Artifacts</span>
            {unpinnedArtifacts.length === 0 ? (
              <p className="sidebar-empty">
                {pinnedArtifacts.length > 0
                  ? "Everything's pinned."
                  : "No artifacts yet. Pin blocks from the thread."}
              </p>
            ) : (
              <ul className="spine-items" role="list">
                {unpinnedArtifacts.map((a) => (
                  <ArtifactRow
                    key={a.id}
                    artifact={a}
                    onTogglePin={() => void togglePin(a)}
                    flash={flashId === a.id}
                    setRowRef={setRowRef}
                  />
                ))}
              </ul>
            )}
          </div>

          {/* TODO(DP-C): un-hide the "Code files" spine section once the
              workspace-scoped file index lands (TODO(13.E)). The empty-state
              placeholder was misleading — exposing it without a real index
              gave the impression the section was broken. Audit table:
              core-docs/plan.md § Feature readiness. */}

          <div className="spine-section">
            <span className="sidebar-label">Agents</span>
            {agentRows.length === 0 ? (
              <p className="sidebar-empty">No agents running.</p>
            ) : (
              <ul className="spine-list" role="tree" aria-label="Agents">
                {agentRows.map(({ row, depth }) => (
                  <AgentSpineRow key={row.id} row={row} depth={depth} />
                ))}
              </ul>
            )}
          </div>

          <div className="spine-section">
            <span className="sidebar-label">Recent events</span>
            {events.length === 0 ? (
              <p className="sidebar-empty">No events yet.</p>
            ) : (
              <ul className="spine-events" role="list">
                {events.map((e, i) => (
                  // Fallback to index because the mock seeds duplicate
                  // stream_id+sequence pairs across workspaces (see mock.ts).
                  <li key={`${e.stream_id}:${e.sequence}:${i}`}>
                    <span className="spine-event__time">
                      {new Date(e.timestamp).toLocaleTimeString()}
                    </span>
                    <span className="spine-event__body">
                      {humanizeKind(e.kind)}
                      {e.summary ? ` · ${e.summary}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

/**
 * Single agent row in the spine tree. Pulled out so each row can run
 * its own `useRecentActivity` gate — the pulse on `state="active"`
 * runs only while the agent's stream has had a recent event.
 */
function AgentSpineRow({ row, depth }: { row: SpineRow; depth: number }) {
  const latestTs = useDataState((s) =>
    latestActivityForStream(s.recentActivityTs, row.id),
  );
  const recent = useRecentActivity(latestTs);
  return (
    <li role="treeitem" aria-label={row.label}>
      <Tooltip label={row.summary ? `${row.label} · ${row.summary}` : `Follow ${row.label}`}>
        <button
          type="button"
          className="spine-row"
          data-depth={depth}
          style={{ "--depth": depth } as React.CSSProperties}
          onClick={() => setFollowingAgent(row.id)}
          aria-label={`${row.label}: ${row.summary ?? "no activity"}`}
        >
          <span
            className="state-dot"
            data-state={row.state}
            data-active-ts-recent={recent ? "true" : undefined}
            aria-hidden="true"
          />
          <span className="spine-row__body">
            <span className="spine-row__label">{row.label}</span>
            {row.summary && (
              <span className="spine-row__summary">{row.summary}</span>
            )}
          </span>
        </button>
      </Tooltip>
    </li>
  );
}

function flattenSpine(rows: SpineRow[], depth = 0): { row: SpineRow; depth: number }[] {
  const out: { row: SpineRow; depth: number }[] = [];
  for (const r of rows) {
    out.push({ row: r, depth });
    const children = r.children ?? [];
    if (children.length > 0) {
      out.push(...flattenSpine(children, depth + 1));
    }
  }
  return out;
}

function filterOutArtifacts(rows: SpineRow[]): SpineRow[] {
  return rows
    .filter((r) => r.altitude !== "artifact")
    .map((r) => ({
      ...r,
      children: filterOutArtifacts(r.children ?? []),
    }));
}

function countState(rows: SpineRow[], state: SpineRow["state"]): number {
  let total = 0;
  for (const r of rows) {
    if (r.state === state) total++;
    total += countState(r.children ?? [], state);
  }
  return total;
}

function ArtifactRow({
  artifact,
  onTogglePin,
  flash,
  setRowRef,
}: {
  artifact: ArtifactSummary;
  onTogglePin: () => void;
  flash: boolean;
  setRowRef: (id: string, el: HTMLLIElement | null) => void;
}) {
  const label = artifact.title;
  // The summary is preserved in the tooltip — there's only room for one
  // line of text in the rail, and the title carries more identity than
  // the right-aligned summary did.
  const tooltip = artifact.summary
    ? `${label} · ${artifact.summary}`
    : label;
  return (
    <li
      className="spine-artifact"
      data-flash={flash || undefined}
      ref={(el) => setRowRef(artifact.id, el)}
    >
      <Tooltip label={tooltip}>
        <div className="spine-artifact__body">
          <FileText size={14} strokeWidth={1.5} aria-hidden="true" />
          <span className="spine-item__label">{label}</span>
        </div>
      </Tooltip>
      <button
        type="button"
        className="spine-artifact__pin"
        aria-label={artifact.pinned ? "Unpin" : "Pin"}
        aria-pressed={artifact.pinned}
        onClick={onTogglePin}
      >
        <Pin size={12} strokeWidth={1.5} aria-hidden="true" />
      </button>
    </li>
  );
}
