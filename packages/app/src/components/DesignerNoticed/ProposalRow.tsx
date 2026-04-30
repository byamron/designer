import { useCallback, useId, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import type {
  ProposalDto,
  ProposalResolution,
  ThumbSignal,
} from "../../ipc/types";

/**
 * Phase 21.A1.2 — proposal row. Replaces `FindingRow` as the
 * user-facing unit on every Designer noticed surface. A proposal is a
 * recommendation; findings are evidence behind the "from N
 * observations" disclosure inside this row.
 *
 * Layout per row:
 *   - severity dot (data-severity drives the left border accent)
 *   - title + summary
 *   - "from N observations" disclosure → expandable evidence drawer
 *     listing the source `Finding.summary` lines
 *   - Accept / Edit / Dismiss / Snooze actions
 *   - optional `calibrated 👍/👎` badge after thumbing
 *
 * The user thumbs a *proposal* (a recommendation) here — never a
 * finding. Phase B reads the signal to retune detector / synthesizer
 * thresholds; Phase 21.A1.2 just persists it so the badge can render.
 */
export function ProposalRow({
  proposal,
  signal,
  onSignal,
  onResolve,
}: {
  proposal: ProposalDto;
  signal: ThumbSignal | null;
  onSignal: (id: string, signal: ThumbSignal) => void;
  onResolve: (id: string, resolution: ProposalResolution) => void;
}) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const evidenceId = useId();
  const evidence = proposal.evidence ?? [];
  const calibratedSignal: ThumbSignal | null =
    signal ?? proposal.calibration?.signal ?? null;
  const isResolved = proposal.status !== "open";

  const onAccept = useCallback(
    () => onResolve(proposal.id, { kind: "accepted" }),
    [proposal.id, onResolve],
  );
  const onEdit = useCallback(
    () => onResolve(proposal.id, { kind: "edited" }),
    [proposal.id, onResolve],
  );
  const onDismiss = useCallback(
    () => onResolve(proposal.id, { kind: "dismissed" }),
    [proposal.id, onResolve],
  );
  const onSnooze = useCallback(
    () => onResolve(proposal.id, { kind: "snoozed" }),
    [proposal.id, onResolve],
  );

  return (
    <li
      className="designer-noticed__row designer-noticed__proposal"
      data-severity={proposal.severity}
      data-status={proposal.status}
    >
      <div className="designer-noticed__row-text">
        <span className="designer-noticed__row-title">{proposal.title}</span>
        <span className="designer-noticed__row-summary">
          {proposal.summary}
        </span>
        <span className="designer-noticed__row-meta">
          {proposal.severity}
          {evidence.length > 0 && (
            <>
              {" · "}
              <button
                type="button"
                className="designer-noticed__evidence-toggle"
                aria-expanded={evidenceOpen}
                aria-controls={evidenceId}
                onClick={() => setEvidenceOpen((o) => !o)}
              >
                from {evidence.length}{" "}
                {evidence.length === 1 ? "observation" : "observations"}
              </button>
            </>
          )}
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
          {isResolved && (
            <>
              {" · "}
              <span
                className="designer-noticed__status-badge"
                data-status={proposal.status}
              >
                {proposal.status}
              </span>
            </>
          )}
        </span>
        {evidenceOpen && evidence.length > 0 && (
          <ul
            id={evidenceId}
            className="designer-noticed__evidence"
            role="list"
            aria-label="Source observations"
          >
            {evidence.map((f) => (
              <li
                key={f.id}
                className="designer-noticed__evidence-item"
                data-severity={f.severity}
              >
                <span className="designer-noticed__evidence-summary">
                  {f.summary}
                </span>
                <span className="designer-noticed__evidence-meta">
                  {f.detector_name} · {f.severity}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        className="designer-noticed__row-actions"
        role="group"
        aria-label={`Actions on "${proposal.title}"`}
      >
        {!isResolved && (
          <>
            <button
              type="button"
              className="designer-noticed__action"
              data-variant="primary"
              onClick={onAccept}
            >
              Accept
            </button>
            <button
              type="button"
              className="designer-noticed__action"
              onClick={onEdit}
            >
              Edit
            </button>
            <button
              type="button"
              className="designer-noticed__action"
              onClick={onDismiss}
            >
              Dismiss
            </button>
            <button
              type="button"
              className="designer-noticed__action"
              onClick={onSnooze}
            >
              Snooze
            </button>
          </>
        )}
        <button
          type="button"
          className="designer-noticed__signal"
          data-active={calibratedSignal === "up"}
          aria-pressed={calibratedSignal === "up"}
          aria-label="Useful — keep showing recommendations like this"
          onClick={() => onSignal(proposal.id, "up")}
        >
          <ThumbsUp size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="designer-noticed__signal"
          data-active={calibratedSignal === "down"}
          aria-pressed={calibratedSignal === "down"}
          aria-label="Noise — quiet recommendations like this"
          onClick={() => onSignal(proposal.id, "down")}
        >
          <ThumbsDown size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}

/** Severity-then-recency sort. Warning > Notice > Info; newer first within. */
export function sortProposalsForHome(proposals: ProposalDto[]): ProposalDto[] {
  const rank: Record<string, number> = { warn: 0, notice: 1, info: 2 };
  return [...proposals].sort((a, b) => {
    const sev = (rank[a.severity] ?? 99) - (rank[b.severity] ?? 99);
    if (sev !== 0) return sev;
    return b.created_at.localeCompare(a.created_at);
  });
}
