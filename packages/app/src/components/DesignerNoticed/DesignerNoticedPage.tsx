import { useEffect } from "react";
import type { ProjectId } from "../../ipc/types";
import { markNoticedViewed } from "../../store/app";
import { FindingRow } from "./FindingRow";
import { useFindings } from "./useFindings";

/**
 * Settings → Activity → "Designer noticed" — full archive of findings
 * the learning layer (Phase 21) has recorded for the active project.
 * Thumbs-up / thumbs-down per finding for calibration.
 *
 * Phase 21.A1.1 makes this the *archive* sibling of the workspace-home
 * live feed (`DesignerNoticedHome`): the home tab shows the top-N
 * severity-sorted slice; this page is the historian.
 *
 * Settings IA: locked under Activity per Track 13.K's spec
 * (`core-docs/roadmap.md` §"Settings IA (locked)"). Friction is the
 * sibling page; both consume gate-style read endpoints from Rust core.
 */
export function DesignerNoticedPage({ projectId }: { projectId: ProjectId | null }) {
  const { findings, signaled, onSignal, loading, error } = useFindings(projectId);

  // Opening the archive clears the unread badge — viewing here is the
  // same "I'm caught up" signal as opening the workspace home.
  useEffect(() => {
    if (projectId) markNoticedViewed();
  }, [projectId]);

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
          Nothing noticed yet — keep working and Designer will surface
          patterns it sees.
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
        Full archive of patterns the learning layer has spotted across
        this project. Thumbs-up signals help calibrate; thumbs-down
        quiets the signal. The workspace home shows the live top-N feed.
      </p>
    </header>
  );
}
