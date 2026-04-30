import { useCallback, useEffect, useState } from "react";
import { ipcClient } from "../../ipc/client";
import { describeIpcError } from "../../ipc/error";
import {
  EVENT_KIND,
  type ProjectId,
  type ProposalDto,
  type ProposalResolution,
  type ProposalStatus,
  type ThumbSignal,
} from "../../ipc/types";
import { emptyArray } from "../../util/empty";
import { useDataState } from "../../store/data";

/**
 * Phase 21.A1.2 — proposal fetch + thumb-signal hook. Replaces the
 * Phase 21.A1.1 `useFindings` hook on every user-facing surface;
 * findings are now evidence rendered behind each proposal's "from N
 * observations" disclosure, not their own list.
 *
 * Behavior:
 *  - Fetches `cmd_list_proposals` on mount and whenever `projectId` or
 *    `statusFilter` changes.
 *  - Auto-refetches when a `proposal_emitted` / `proposal_resolved` /
 *    `proposal_signaled` event streams in. Findings (`finding_recorded`
 *    / `finding_signaled`) do NOT trigger a refetch — they're scratch
 *    buffer state, not user-facing.
 *  - Tracks an optimistic `signaled` map so the calibrated badge
 *    appears the instant the user thumbs a proposal, then yields to
 *    the persisted projection on the next refresh.
 */
export function useProposals(
  projectId: ProjectId | null,
  statusFilter: ProposalStatus | null = null,
) {
  const [proposals, setProposals] = useState<ProposalDto[]>(emptyArray);
  const [signaled, setSignaled] = useState<Record<string, ThumbSignal>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Refetch trigger: latest sequence among proposal-* events.
  const proposalEventSeq = useDataState((s) =>
    s.events.reduce<number>(
      (acc, e) =>
        e.kind === EVENT_KIND.PROPOSAL_EMITTED ||
        e.kind === EVENT_KIND.PROPOSAL_RESOLVED ||
        e.kind === EVENT_KIND.PROPOSAL_SIGNALED
          ? Math.max(acc, e.sequence)
          : acc,
      0,
    ),
  );

  useEffect(() => {
    if (!projectId) {
      setProposals(emptyArray());
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    ipcClient()
      .listProposals({ project_id: projectId, status_filter: statusFilter })
      .then((rows) => {
        if (!cancelled) setProposals(rows);
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
  }, [projectId, statusFilter, proposalEventSeq]);

  const onSignal = useCallback(
    async (id: string, signal: ThumbSignal) => {
      setSignaled((prev) => ({ ...prev, [id]: signal }));
      try {
        await ipcClient().signalProposal({ proposal_id: id, signal });
      } catch {
        // Roll back the optimistic update; thumbing isn't blocking, the
        // user can retry.
        setSignaled((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    },
    [],
  );

  const onResolve = useCallback(
    async (id: string, resolution: ProposalResolution) => {
      try {
        await ipcClient().resolveProposal({
          proposal_id: id,
          resolution,
        });
      } catch (err) {
        setError(describeIpcError(err));
      }
    },
    [],
  );

  return { proposals, signaled, onSignal, onResolve, loading, error };
}
