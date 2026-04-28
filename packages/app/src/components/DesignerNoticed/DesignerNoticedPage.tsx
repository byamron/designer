import { useCallback, useEffect, useState } from "react";
import { ipcClient } from "../../ipc/client";
import { describeIpcError } from "../../ipc/error";
import type { FindingDto, ProjectId, ThumbSignal } from "../../ipc/types";
import { emptyArray } from "../../util/empty";
import { markNoticedViewed } from "../../store/app";
import { FindingRow } from "./FindingRow";

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
  const [findings, setFindings] = useState<FindingDto[]>(emptyArray);
  const [signaled, setSignaled] = useState<Record<string, ThumbSignal>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setFindings(emptyArray());
      return;
    }
    // Opening the archive clears the unread badge — viewing here is
    // the same "I'm caught up" signal as opening the workspace home.
    markNoticedViewed();
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
        Full archive of patterns the learning layer has spotted across
        this project. Thumbs-up signals help calibrate; thumbs-down
        quiets the signal. The workspace home shows the live top-N feed.
      </p>
    </header>
  );
}
