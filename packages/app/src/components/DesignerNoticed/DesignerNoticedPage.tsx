import { useCallback, useEffect, useState } from "react";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { ipcClient } from "../../ipc/client";
import { describeIpcError } from "../../ipc/error";
import type { FindingDto, ProjectId, ThumbSignal } from "../../ipc/types";
import { emptyArray } from "../../util/empty";

/**
 * Settings → Activity → "Designer noticed" — read-only listing of
 * findings the learning layer (Phase 21) has recorded for the active
 * project, with thumbs-up / thumbs-down per finding for calibration.
 *
 * Phase 21.A1 ships only the *read* + thumb-signal surface. The
 * "what-to-do-about-this-finding" UI (proposal acceptance, inline
 * accept/edit/dismiss) is Phase B's responsibility once the
 * `LocalOps::analyze_session` pipeline lands.
 *
 * Settings IA: locked under Activity per Track 13.K's spec
 * (`core-docs/roadmap.md` §"Settings IA (locked)"). Friction is the
 * sibling page; both consume gate-style read endpoints from Rust core.
 */
export function DesignerNoticedPage({ projectId }: { projectId: ProjectId | null }) {
  const [findings, setFindings] = useState<FindingDto[]>(emptyArray);
  const [signaled, setSignaled] = useState<Record<string, ThumbSignal>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setFindings(emptyArray());
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    ipcClient()
      .listFindings(projectId)
      .then((rows) => {
        if (!cancelled) setFindings(rows);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(describeIpcError(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const onSignal = useCallback(
    async (id: string, signal: ThumbSignal) => {
      setSignaled((prev) => ({ ...prev, [id]: signal }));
      try {
        await ipcClient().signalFinding({ finding_id: id, signal });
      } catch {
        // Roll back the optimistic update so the UI doesn't lie about
        // persisted calibration. We don't surface the failure inline —
        // a finding that can't be signaled isn't blocking; the user
        // can retry.
        setSignaled((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [],
  );

  if (!projectId) {
    return (
      <>
        <SectionHeader />
        <p className="settings-page__section-description">
          Open a project to see what Designer's been noticing.
        </p>
      </>
    );
  }

  return (
    <>
      <SectionHeader />
      {loading && (
        <p className="settings-page__section-description">Loading…</p>
      )}
      {error && (
        <p className="settings-page__section-description" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && findings.length === 0 && (
        <p className="settings-page__section-description">
          Nothing noticed yet. Designer collects signal as you work — keep
          dogfooding and findings will appear here.
        </p>
      )}
      {findings.length > 0 && (
        <ul className="designer-noticed__list" role="list">
          {findings.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              signal={signaled[f.id] ?? null}
              onSignal={onSignal}
            />
          ))}
        </ul>
      )}
    </>
  );
}

function SectionHeader() {
  return (
    <header className="settings-page__section-header">
      <h2 className="settings-page__section-title">Designer noticed</h2>
      <p className="settings-page__section-description">
        Patterns the learning layer has spotted. Thumbs-up signals help
        calibrate; thumbs-down quiets the signal. No edits are applied
        from this page.
      </p>
    </header>
  );
}

function FindingRow({
  finding,
  signal,
  onSignal,
}: {
  finding: FindingDto;
  signal: ThumbSignal | null;
  onSignal: (id: string, signal: ThumbSignal) => void;
}) {
  const confidencePct = Math.round(finding.confidence * 100);
  return (
    <li className="designer-noticed__row" data-severity={finding.severity}>
      <div className="designer-noticed__row-text">
        <span className="designer-noticed__row-summary">{finding.summary}</span>
        <span className="designer-noticed__row-meta">
          {finding.detector_name} · {finding.severity} · {confidencePct}%
          confidence
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
          data-active={signal === "up"}
          aria-pressed={signal === "up"}
          aria-label="Useful — keep showing patterns like this"
          onClick={() => onSignal(finding.id, "up")}
        >
          <ThumbsUp size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
        <button
          type="button"
          className="designer-noticed__signal"
          data-active={signal === "down"}
          aria-pressed={signal === "down"}
          aria-label="Noise — quiet patterns like this"
          onClick={() => onSignal(finding.id, "down")}
        >
          <ThumbsDown size={14} strokeWidth={1.5} aria-hidden="true" />
        </button>
      </div>
    </li>
  );
}
