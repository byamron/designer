import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { FindingDto, ThumbSignal } from "../../ipc/types";

/**
 * Shared row component used by both the workspace-home live feed
 * (`DesignerNoticedHome`) and the Settings → Activity → Designer
 * noticed archive (`DesignerNoticedPage`). Splitting the row out
 * keeps the calibrated badge + thumb buttons in one place; the two
 * surfaces only diverge on filtering and sort order, not on the row
 * shape.
 *
 * Phase 21.A1.1 adds the `calibrated 👍/👎` badge: a row with any
 * `FindingSignaled` event in its projection (carried in
 * `finding.calibration`) shows a persistent badge, alongside the
 * optimistic local `signal` state so the badge appears immediately
 * after the user thumbs without waiting for the next list refresh.
 */
export function FindingRow({
  finding,
  signal,
  onSignal,
}: {
  finding: FindingDto;
  signal: ThumbSignal | null;
  onSignal: (id: string, signal: ThumbSignal) => void;
}) {
  const confidencePct = Math.round(finding.confidence * 100);
  // Optimistic local thumb wins over the persisted projection so the
  // badge updates the instant the user clicks; once the next refresh
  // lands, the projection becomes the source of truth.
  const calibratedSignal: ThumbSignal | null =
    signal ?? finding.calibration?.signal ?? null;
  return (
    <li className="designer-noticed__row" data-severity={finding.severity}>
      <div className="designer-noticed__row-text">
        <span className="designer-noticed__row-summary">{finding.summary}</span>
        <span className="designer-noticed__row-meta">
          {finding.detector_name} · {finding.severity} · {confidencePct}%
          confidence
          {calibratedSignal && (
            <>
              {" · "}
              <span
                className="designer-noticed__calibrated-badge"
                data-signal={calibratedSignal}
              >
                <span aria-hidden="true">
                  {calibratedSignal === "up" ? "👍" : "👎"}
                </span>
                calibrated
              </span>
            </>
          )}
        </span>
      </div>
      <div
        className="designer-noticed__row-actions"
        role="group"
        aria-label={`Signal feedback on "${finding.summary}"`}
      >
        <button
          type="button"
          className="designer-noticed__signal"
          data-active={calibratedSignal === "up"}
          aria-pressed={calibratedSignal === "up"}
          aria-label="Useful — keep showing patterns like this"
          onClick={() => onSignal(finding.id, "up")}
        >
          <ThumbsUp size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="designer-noticed__signal"
          data-active={calibratedSignal === "down"}
          aria-pressed={calibratedSignal === "down"}
          aria-label="Noise — quiet patterns like this"
          onClick={() => onSignal(finding.id, "down")}
        >
          <ThumbsDown size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/**
 * Severity-then-recency sort used by the workspace-home top-N feed.
 * Warning > Notice > Info; within a severity bucket, newer findings
 * land first. Stable on equal keys.
 */
export function sortFindingsForHome(findings: FindingDto[]): FindingDto[] {
  const rank: Record<string, number> = { warn: 0, notice: 1, info: 2 };
  return [...findings].sort((a, b) => {
    const sev = (rank[a.severity] ?? 99) - (rank[b.severity] ?? 99);
    if (sev !== 0) return sev;
    return b.timestamp.localeCompare(a.timestamp);
  });
}
