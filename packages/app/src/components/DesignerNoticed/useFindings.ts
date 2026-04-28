import { useCallback, useEffect, useState } from "react";
import { ipcClient } from "../../ipc/client";
import { describeIpcError } from "../../ipc/error";
import {
  EVENT_KIND,
  type FindingDto,
  type ProjectId,
  type ThumbSignal,
} from "../../ipc/types";
import { emptyArray } from "../../util/empty";
import { useDataState } from "../../store/data";

/**
 * Shared fetch + thumb-signal hook for the workspace-home live feed
 * (`DesignerNoticedHome`) and the Settings archive (`DesignerNoticedPage`).
 *
 * Behavior:
 *  - Fetches `cmd_list_findings` on mount and whenever `projectId` changes.
 *  - Auto-refetches when a `finding_recorded` or `finding_signaled` event
 *    streams in, so the surface stays live without polling.
 *  - Tracks an optimistic `signaled` map so the calibrated badge appears
 *    the instant the user thumbs, then yields to the persisted projection
 *    on the next refresh. Failed signals roll back transparently.
 */
export function useFindings(projectId: ProjectId | null) {
  const [findings, setFindings] = useState<FindingDto[]>(emptyArray);
  const [signaled, setSignaled] = useState<Record<string, ThumbSignal>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refetch trigger: the latest sequence among `finding_*` events.
  // Bumping this drives `useEffect` below.
  const findingEventSeq = useDataState((s) =>
    s.events.reduce<number>(
      (acc, e) =>
        e.kind === EVENT_KIND.FINDING_RECORDED ||
        e.kind === EVENT_KIND.FINDING_SIGNALED
          ? Math.max(acc, e.sequence)
          : acc,
      0,
    ),
  );

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
  }, [projectId, findingEventSeq]);

  const onSignal = useCallback(
    async (id: string, signal: ThumbSignal) => {
      setSignaled((prev) => ({ ...prev, [id]: signal }));
      try {
        await ipcClient().signalFinding({ finding_id: id, signal });
      } catch {
        // Roll back the optimistic update so the UI doesn't lie about
        // persisted calibration. We don't surface the failure inline —
        // a finding that can't be signaled isn't blocking; the user can
        // retry by clicking the same button.
        setSignaled((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [],
  );

  return { findings, signaled, onSignal, loading, error };
}
