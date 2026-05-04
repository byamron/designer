import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ArtifactDetail,
  ProjectId,
  RecentReportRow,
  ReportClassification,
} from "../../ipc/types";
import { ipcClient } from "../../ipc/client";
import { selectWorkspace } from "../../store/app";

/**
 * Phase 22.B — Recent Reports surface.
 *
 * Curated highlights of shipped work, written in plain language about
 * user-facing impact. Two-step disclosure: an inline summary row sits
 * always-visible with classification chip + workspace label + PR link;
 * clicking expands the report inline with the full body and an
 * "Open in tab" button. Only that last step creates a tab.
 *
 * Section header reflects the unread count ("3 unread" / "All caught
 * up"); reading is implicit-mark on inline expand and on tab open.
 */

const DEFAULT_VISIBLE = 3;
const SHOW_MORE_VISIBLE = 5;

type Disclosure = "collapsed" | "expanded";

const CLASSIFICATION_LABELS: Record<ReportClassification, string> = {
  feature: "Feature",
  fix: "Fix",
  improvement: "Improvement",
  reverted: "Reverted",
};

export function RecentReportsSection({ projectId }: { projectId: ProjectId }) {
  const [reports, setReports] = useState<RecentReportRow[] | null>(null);
  const [unread, setUnread] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [visibleCap, setVisibleCap] = useState<number>(DEFAULT_VISIBLE);
  const [disclosure, setDisclosure] = useState<Record<string, Disclosure>>({});
  // Once `markReportsRead` resolves, we want the unread badge to flip
  // immediately rather than waiting for the next refetch — track that
  // locally so we don't need to round-trip through the backend on the
  // expand path.
  const markedRef = useRef(false);

  const refetch = useCallback(async () => {
    setError(null);
    try {
      const [list, count] = await Promise.all([
        ipcClient().listRecentReports(projectId),
        ipcClient().getReportsUnreadCount(projectId),
      ]);
      setReports(list);
      setUnread(count);
    } catch (err) {
      // Raw IPC error strings ("ChannelClosed", "InvalidRequest") aren't
      // useful to the manager-grade reader; log the detail for triage
      // and surface a friendly line. The next refetch will recover.
      console.warn("Recent Reports load failed", err);
      setError("Couldn't load recent reports — try refreshing.");
      setReports([]);
    }
  }, [projectId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  // Reset on project switch.
  useEffect(() => {
    setVisibleCap(DEFAULT_VISIBLE);
    setDisclosure({});
    markedRef.current = false;
  }, [projectId]);

  const showMore = useCallback(() => {
    setVisibleCap((cap) => {
      if (cap >= (reports?.length ?? 0)) return cap;
      if (cap < SHOW_MORE_VISIBLE) return SHOW_MORE_VISIBLE;
      return reports?.length ?? cap;
    });
  }, [reports]);

  const markRead = useCallback(async () => {
    if (markedRef.current) return;
    markedRef.current = true;
    try {
      const remaining = await ipcClient().markReportsRead(projectId);
      setUnread(remaining);
    } catch {
      // Allow a future explicit "Mark all read" click to retry.
      markedRef.current = false;
    }
  }, [projectId]);

  const onToggle = useCallback(
    (id: string) => {
      setDisclosure((prev) => {
        const next = { ...prev };
        if (next[id] === "expanded") {
          delete next[id];
        } else {
          next[id] = "expanded";
          // Implicit-mark: any inline expand counts as "I've seen it".
          void markRead();
        }
        return next;
      });
    },
    [markRead],
  );

  const visible = useMemo(
    () => (reports ?? []).slice(0, visibleCap),
    [reports, visibleCap],
  );

  const total = reports?.length ?? 0;
  const trailing = total === 0
    ? null
    : unread > 0
      ? `${unread} unread`
      : "All caught up";

  return (
    <section className="recent-reports home-a__section" aria-label="Recent Reports">
      <header className="home-a__section-head">
        <h3 className="home-a__section-label">Recent Reports</h3>
        {trailing && (
          <span
            className="home-a__section-trailing"
            data-variant={unread > 0 ? "warning" : undefined}
          >
            {trailing}
          </span>
        )}
      </header>

      {error && (
        <p className="home-a__explain" role="alert">
          {error}
        </p>
      )}

      {!error && reports !== null && reports.length === 0 && (
        <p className="home-a__explain">
          Nothing shipped yet — highlights will surface here as work lands.
        </p>
      )}

      {reports !== null && reports.length > 0 && (
        <ul className="recent-reports__list" role="list">
          {visible.map((row) => (
            <RecentReportRowView
              key={row.artifact_id}
              row={row}
              expanded={disclosure[row.artifact_id] === "expanded"}
              onToggle={() => onToggle(row.artifact_id)}
              onOpenedTab={markRead}
            />
          ))}
        </ul>
      )}

      {reports !== null && total > visibleCap && (
        <button
          type="button"
          className="home-a__link-btn"
          onClick={showMore}
          title={
            visibleCap < SHOW_MORE_VISIBLE
              ? `Show ${Math.min(SHOW_MORE_VISIBLE, total) - visibleCap} more`
              : `Show all ${total}`
          }
        >
          {visibleCap < SHOW_MORE_VISIBLE ? "Show more" : `Show all (${total})`}
        </button>
      )}

      {reports !== null && reports.length > 0 && unread > 0 && (
        <button
          type="button"
          className="home-a__link-btn"
          onClick={() => void markRead()}
          title="Advance the read mark to the head of the report list"
        >
          Mark all read
        </button>
      )}
    </section>
  );
}

function RecentReportRowView({
  row,
  expanded,
  onToggle,
  onOpenedTab,
}: {
  row: RecentReportRow;
  expanded: boolean;
  onToggle: () => void;
  onOpenedTab: () => Promise<void> | void;
}) {
  const [body, setBody] = useState<string | null>(null);
  const [loadingBody, setLoadingBody] = useState(false);

  useEffect(() => {
    if (!expanded || body !== null) return;
    let cancelled = false;
    setLoadingBody(true);
    void ipcClient()
      .getArtifact(row.artifact_id)
      .then((detail: ArtifactDetail) => {
        if (cancelled) return;
        const text =
          detail.payload.kind === "inline" ? detail.payload.body : "";
        setBody(text);
      })
      .catch(() => {
        if (!cancelled) setBody("");
      })
      .finally(() => {
        if (!cancelled) setLoadingBody(false);
      });
    return () => {
      cancelled = true;
    };
  }, [expanded, body, row.artifact_id]);

  const openInTab = useCallback(async () => {
    selectWorkspace(row.workspace_id);
    try {
      await ipcClient().openTab({
        workspace_id: row.workspace_id,
        title: row.title,
        template: "thread",
        artifact_id: row.artifact_id,
      });
      // Tab open also counts as "seen".
      await onOpenedTab();
      // Mirror the activity-spine click affordance: dispatch the
      // focus-artifact event so the workspace tab lands centred on the
      // report instead of the bottom of the thread. Detail key is `id`
      // (not `artifactId`) — that matches `ArtifactReferenceBlock`'s
      // dispatch and the ActivitySpine listener contract.
      window.dispatchEvent(
        new CustomEvent("designer:focus-artifact", {
          detail: { id: row.artifact_id },
        }),
      );
    } catch {
      // Silent — the user can retry; we don't want to spam toasts on
      // a transient IPC hiccup.
    }
  }, [row, onOpenedTab]);

  return (
    <li
      className="recent-reports__row"
      data-component="RecentReportRow"
      data-expanded={expanded || undefined}
      data-classification={row.classification}
    >
      <button
        type="button"
        className="recent-reports__toggle"
        aria-expanded={expanded}
        aria-controls={`recent-report-detail-${row.artifact_id}`}
        onClick={onToggle}
      >
        <span
          className="recent-reports__chip"
          data-classification={row.classification}
        >
          {CLASSIFICATION_LABELS[row.classification]}
        </span>
        <span className="recent-reports__summary" title={row.summary_high}>
          {row.summary_high}
        </span>
        <span className="recent-reports__meta">
          <span className="recent-reports__workspace" title={row.workspace_name}>
            {row.workspace_name}
          </span>
          {row.pr_url && (
            <>
              <span aria-hidden="true">·</span>
              <a
                className="recent-reports__pr"
                href={row.pr_url}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
              >
                {shortPrLabel(row.pr_url)}
              </a>
            </>
          )}
        </span>
      </button>
      {expanded && (
        <div
          className="recent-reports__detail"
          id={`recent-report-detail-${row.artifact_id}`}
        >
          {loadingBody && body === null && (
            <p className="home-a__explain">Loading…</p>
          )}
          {body !== null && body.length > 0 && (
            <pre className="recent-reports__body">{body}</pre>
          )}
          {body !== null && body.length === 0 && !loadingBody && (
            <p className="home-a__explain">No body recorded for this report.</p>
          )}
          <div className="recent-reports__actions">
            <button
              type="button"
              className="btn"
              onClick={() => void openInTab()}
              title={`Open ${row.title} as a tab in ${row.workspace_name}`}
            >
              Open in tab
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

function shortPrLabel(url: string): string {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (m) return `${m[1]}/${m[2]}#${m[3]}`;
    return u.host + u.pathname;
  } catch {
    return url;
  }
}
