import type { ProjectId } from "../../ipc/types";
import { ProposalRow, sortProposalsForHome } from "./ProposalRow";
import { useProposals } from "./useProposals";

/**
 * Workspace-home "Designer noticed" surface (Phase 21.A1.2). Renders
 * *proposals* — the user-facing recommendations the synthesis pass
 * produces at boundaries (track-complete + first-view-of-day) — not
 * findings. Findings live behind each proposal's "from N observations"
 * disclosure as evidence.
 *
 * The 21.A1.1 "live feed of findings" model (a top-N severity-sorted
 * list updating per `FindingRecorded`) is superseded: detectors keep
 * firing continuously, but the surface only refreshes when a
 * `ProposalEmitted` event lands, which only happens at boundaries.
 *
 * Severity sort within the open list is `Warn` > `Notice` > `Info`,
 * then most-recent first. Limited to `MAX_HOME_PROPOSALS` so the
 * surface doesn't sprawl; the Settings → Activity → Designer noticed
 * archive is the historian.
 */
const MAX_HOME_PROPOSALS = 8;

export function DesignerNoticedHome({ projectId }: { projectId: ProjectId }) {
  const { proposals, signaled, onSignal, onResolve, loading, error } =
    useProposals(projectId, "open");
  const visible = sortProposalsForHome(proposals).slice(0, MAX_HOME_PROPOSALS);
  const overflow = Math.max(0, proposals.length - MAX_HOME_PROPOSALS);

  return (
    <section
      className="designer-noticed-home home-a__section"
      aria-label="Designer noticed"
    >
      <header className="home-a__section-head">
        <h3 className="home-a__section-label">Designer noticed</h3>
        {overflow > 0 && (
          <span className="home-a__section-trailing">
            top {MAX_HOME_PROPOSALS} of {proposals.length}
          </span>
        )}
      </header>
      {loading && proposals.length === 0 && (
        <p className="home-a__explain">Loading…</p>
      )}
      {error && (
        <p className="home-a__explain" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && proposals.length === 0 && (
        <p className="home-a__explain">
          Nothing to suggest yet — Designer reviews patterns when you
          finish a track or once per day.
        </p>
      )}
      {visible.length > 0 && (
        <ul className="designer-noticed__list" role="list">
          {visible.map((p) => (
            <ProposalRow
              key={p.id}
              proposal={p}
              signal={signaled[p.id] ?? null}
              onSignal={onSignal}
              onResolve={onResolve}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
