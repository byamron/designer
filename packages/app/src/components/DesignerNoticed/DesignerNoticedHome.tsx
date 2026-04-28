import { useCallback, useEffect, useState } from "react";
import { ipcClient } from "../../ipc/client";
import { describeIpcError } from "../../ipc/error";
import type { FindingDto, ProjectId, ThumbSignal } from "../../ipc/types";
import { emptyArray } from "../../util/empty";
import { useDataState } from "../../store/data";
import { FindingRow, sortFindingsForHome } from "./FindingRow";

/**
 * Workspace-home "Designer noticed" live feed (Phase 21.A1.1). Renders
 * the top-N severity-sorted findings for the current project at the
 * bottom of the home tab; the Settings → Activity → Designer noticed
 * archive remains the historian for the full list.
 *
 * Severity sort is `Warning` > `Notice` > `Info`, then most-recent
 * first within each bucket. Limited to `MAX_HOME_FINDINGS` so a
 * runaway detector can't dominate the surface — the per-detector
 * session cap on the backend (`DetectorConfig::max_findings_per_session`)
 * is the second line of defense.
 */
const MAX_HOME_FINDINGS = 8;

export function DesignerNoticedHome({ projectId }: { projectId: ProjectId }) {
  const [findings, setFindings] = useState<FindingDto[]>(emptyArray);
  const [signaled, setSignaled] = useState<Record<string, ThumbSignal>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Re-fetch when a `finding_recorded` event lands on the stream so
  // the home feed reflects the latest detector activity without
  // requiring the user to reopen the tab.
  const events = useDataState((s) => s.events);
  const findingRecordedSeq = events.reduce<number>(
    (acc, e) =>
      e.kind === "finding_recorded" || e.kind === "finding_signaled"
        ? Math.max(acc, e.sequence)
        : acc,
    0,
  );

  useEffect(() => {
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
  }, [projectId, findingRecordedSeq]);

  const onSignal = useCallback(
    async (id: string, signal: ThumbSignal) => {
      setSignaled((prev) => ({ ...prev, [id]: signal }));
      try {
        await ipcClient().signalFinding({ finding_id: id, signal });
      } catch {
        setSignaled((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [],
  );

  const visible = sortFindingsForHome(findings).slice(0, MAX_HOME_FINDINGS);

  return (
    <section
      className="designer-noticed-home home-a__section"
      aria-label="Designer noticed"
    >
      <header className="home-a__section-head">
        <h3 className="home-a__section-label">Designer noticed</h3>
        {findings.length > MAX_HOME_FINDINGS && (
          <span className="home-a__section-trailing">
            top {MAX_HOME_FINDINGS} of {findings.length}
          </span>
        )}
      </header>
      {loading && findings.length === 0 && (
        <p className="home-a__explain">Loading…</p>
      )}
      {error && (
        <p className="home-a__explain" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && findings.length === 0 && (
        <p className="home-a__explain">
          Nothing noticed yet — keep working and Designer will surface
          patterns it sees.
        </p>
      )}
      {visible.length > 0 && (
        <ul className="designer-noticed__list" role="list">
          {visible.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              signal={signaled[f.id] ?? null}
              onSignal={onSignal}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
