import type { ProjectId } from "../../ipc/types";
import { FindingRow, sortFindingsForHome } from "./FindingRow";
import { useFindings } from "./useFindings";

/**
 * Workspace-home "Designer noticed" live feed (Phase 21.A1.1). Renders
 * the top-N severity-sorted findings for the current project at the
 * bottom of the home tab; the Settings → Activity → Designer noticed
 * archive remains the historian for the full list.
 *
 * Severity sort is `Warn` > `Notice` > `Info`, then most-recent first
 * within each bucket. Limited to `MAX_HOME_FINDINGS` so a runaway
 * detector can't dominate the surface — the per-detector session cap
 * on the backend (`DetectorConfig::max_findings_per_session`) is the
 * second line of defense.
 */
const MAX_HOME_FINDINGS = 8;

export function DesignerNoticedHome({ projectId }: { projectId: ProjectId }) {
  const { findings, signaled, onSignal, loading, error } = useFindings(projectId);
  const visible = sortFindingsForHome(findings).slice(0, MAX_HOME_FINDINGS);
  const overflow = Math.max(0, findings.length - MAX_HOME_FINDINGS);

  return (
    <section
      className="designer-noticed-home home-a__section"
      aria-label="Designer noticed"
    >
      <header className="home-a__section-head">
        <h3 className="home-a__section-label">Designer noticed</h3>
        {overflow > 0 && (
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
