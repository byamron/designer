import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ComposeDock,
  type ComposeDockHandle,
  type ComposeSendPayload,
} from "../components/ComposeDock";
import { getBlockRenderer, GenericBlock } from "../blocks";
import type { Workspace } from "../ipc/types";
import type { ArtifactDetail, ArtifactId, ArtifactSummary, PayloadRef } from "../ipc/types";
import { ipcClient } from "../ipc/client";
import "../blocks";

const STARTER_SUGGESTIONS = [
  "What are we building?",
  "Describe the feature",
  "Paste a spec",
];

/**
 * The unified workspace surface — every tab renders this component. There
 * are no Plan/Design/Build "modes"; different tabs in the same workspace
 * are additional lenses onto the same artifact pool.
 *
 * Artifacts are loaded once on mount; pin/unpin re-fetches. Block payloads
 * are fetched lazily on expand — for registered kinds whose payload is
 * non-trivial. Unknown kinds fall through to GenericBlock so new event
 * types never crash the thread.
 */
export function WorkspaceThread({ workspace }: { workspace: Workspace }) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null);
  const [payloads, setPayloads] = useState<Record<ArtifactId, PayloadRef>>({});
  const [expanded, setExpanded] = useState<Record<ArtifactId, boolean>>({});
  const composeRef = useRef<ComposeDockHandle | null>(null);

  const refresh = useCallback(async () => {
    const next = await ipcClient().listArtifacts(workspace.id);
    setArtifacts(next);
  }, [workspace.id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch whenever the backend emits an artifact lifecycle event on this
  // workspace's stream. 13.D/E/F/G drive this — users don't need to reload
  // the tab to see a new artifact land.
  useEffect(() => {
    const unsub = ipcClient().stream((event) => {
      if (!event.kind.startsWith("artifact_")) return;
      const wsScope =
        event.stream_id === workspace.id ||
        event.stream_id.startsWith(`${workspace.id}:`);
      if (!wsScope) return;
      void refresh();
    });
    return unsub;
  }, [workspace.id, refresh]);

  const fetchPayload = useCallback(async (id: ArtifactId) => {
    if (payloads[id]) return;
    try {
      const detail: ArtifactDetail = await ipcClient().getArtifact(id);
      setPayloads((p) => ({ ...p, [id]: detail.payload }));
    } catch {
      // Speculative kinds whose emitters aren't wired may 404 — non-fatal.
    }
  }, [payloads]);

  const onToggleExpanded = useCallback(
    (id: ArtifactId) => {
      const willExpand = !expanded[id];
      setExpanded((e) => ({ ...e, [id]: willExpand }));
      if (willExpand) void fetchPayload(id);
    },
    [expanded, fetchPayload],
  );

  const onTogglePin = useCallback(
    async (id: ArtifactId) => {
      await ipcClient().togglePinArtifact(id);
      await refresh();
    },
    [refresh],
  );

  const [sendNotice, setSendNotice] = useState<string | null>(null);
  const onSend = useCallback((payload: ComposeSendPayload) => {
    // Wire the real message append in Phase 13.D (Orchestrator.post_message).
    // Until then surface an explicit "not yet wired" notice instead of
    // silently eating the draft — the user otherwise wonders why nothing
    // happens and whether their text was lost.
    if (payload.text || payload.attachments.length > 0) {
      setSendNotice("Agent wiring lands in Phase 13.D. Draft cleared.");
      window.setTimeout(() => setSendNotice(null), 3000);
    }
  }, []);

  const showEmpty = useMemo(
    () => artifacts !== null && artifacts.length === 0,
    [artifacts],
  );

  return (
    <div className="workspace-thread">
      <div className="thread" role="log" aria-live="polite" aria-label="Workspace thread">
        {showEmpty && (
          <div className="thread__empty">
            <h2 className="thread__empty-title">What are we building?</h2>
            <div className="thread__empty-suggestions">
              {STARTER_SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="thread__suggestion"
                  onClick={() => {
                    composeRef.current?.setDraft(s);
                    composeRef.current?.focus();
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {artifacts?.map((a) => {
          const Renderer = getBlockRenderer(a.kind) ?? GenericBlock;
          return (
            <Renderer
              key={a.id}
              artifact={a}
              payload={payloads[a.id] ?? null}
              isPinned={a.pinned}
              onTogglePin={() => void onTogglePin(a.id)}
              expanded={!!expanded[a.id]}
              onToggleExpanded={() => onToggleExpanded(a.id)}
            />
          );
        })}
      </div>
      <div className="workspace-thread__compose">
        {sendNotice && (
          <div className="workspace-thread__notice" role="status">
            {sendNotice}
          </div>
        )}
        <ComposeDock ref={composeRef} onSend={onSend} />
      </div>
    </div>
  );
}
