import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, ArrowRight, ChevronRight, Wrench } from "lucide-react";
import {
  ComposeDock,
  type ComposeDockHandle,
  type ComposeSendPayload,
} from "../components/ComposeDock";
import { getBlockRenderer, GenericBlock } from "../blocks";
import type { Workspace } from "../ipc/types";
import type { ArtifactDetail, ArtifactId, ArtifactSummary, PayloadRef } from "../ipc/types";
import { ipcClient } from "../ipc/client";
import { describeIpcError } from "../ipc/error";
import "../blocks";

/**
 * Default suggestions for a fresh workspace. When the workspace already
 * has artifacts in motion, `buildSuggestions()` below overrides these
 * with context-aware prompts sourced from the most recent activity.
 */
const STARTER_SUGGESTIONS = [
  "What are we building?",
  "Describe the feature in one paragraph",
  "Paste a spec, diagram, or wireframe",
  "Review the recent activity and suggest next steps",
];

/** Derive a short suggestion list from the workspace's recent artifacts.
 *  Falls back to the static starters when nothing interesting is in
 *  flight — matches the "new tab picks up where you left off" pattern. */
function buildSuggestions(artifacts: ArtifactSummary[]): string[] {
  if (artifacts.length === 0) return STARTER_SUGGESTIONS;
  const picks: string[] = [];
  const latestSpec = artifacts.find((a) => a.kind === "spec");
  if (latestSpec) picks.push(`Continue working on "${latestSpec.title}"`);
  const openPr = artifacts.find((a) => a.kind === "pr");
  if (openPr) picks.push(`Check on ${openPr.title}`);
  const pendingApproval = artifacts.find((a) => a.kind === "approval");
  if (pendingApproval) picks.push(`Resolve: ${pendingApproval.title}`);
  const latestCodeChange = artifacts.find((a) => a.kind === "code-change");
  if (latestCodeChange) picks.push(`Review the latest code changes`);
  // Always keep a catch-all "describe something new" slot at the end.
  picks.push("Describe something new");
  return picks.slice(0, 5);
}

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
  // A freshly mounted tab starts in "suggest" mode — shows roadmap /
  // recent-activity prompts instead of the thread. First send (or first
  // suggestion pick) flips it to "thread" mode. State is per-tab because
  // WorkspaceThread is keyed on `${workspace}:${tab}` in MainView.
  const [hasStarted, setHasStarted] = useState(false);
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
  // the tab to see a new artifact land. Bursts are coalesced on
  // requestAnimationFrame so a flurry of artifact_appended events from a
  // single track produces one refresh, not N.
  useEffect(() => {
    let pending = 0;
    // The Rust core serializes `StreamId::Workspace(uuid)` as
    // `"workspace:<uuid>"` (see `designer_core::ids::StreamId::Display`).
    // The bare-uuid form is the historical mock shape — accept both so
    // tests written against the mock and the real Tauri stream both
    // trigger refresh. Sub-streams (`workspace:<uuid>:<suffix>`) are
    // future-proofed: any prefix beginning with `workspace:<uuid>` and
    // followed by `:` is in scope for this workspace.
    const wsId = workspace.id;
    const productionPrefix = `workspace:${wsId}`;
    const unsub = ipcClient().stream((event) => {
      if (!event.kind.startsWith("artifact_")) return;
      const sid = event.stream_id;
      const wsScope =
        sid === productionPrefix ||
        sid.startsWith(`${productionPrefix}:`) ||
        sid === wsId ||
        sid.startsWith(`${wsId}:`);
      if (!wsScope) return;
      if (pending) return;
      pending = window.requestAnimationFrame(() => {
        pending = 0;
        void refresh();
      });
    });
    return () => {
      if (pending) window.cancelAnimationFrame(pending);
      unsub();
    };
  }, [workspace.id, refresh]);

  // Payload fetch uses functional setState so we don't depend on the
  // payloads map — keeps the callback identity stable across loads,
  // which in turn keeps onToggleExpanded stable, which keeps inline
  // block-renderer props stable across renders.
  const fetchPayload = useCallback(async (id: ArtifactId) => {
    let alreadyHave = false;
    setPayloads((prev) => {
      alreadyHave = id in prev;
      return prev;
    });
    if (alreadyHave) return;
    try {
      const detail: ArtifactDetail = await ipcClient().getArtifact(id);
      setPayloads((p) => ({ ...p, [id]: detail.payload }));
    } catch {
      // Speculative kinds whose emitters aren't wired may 404 — non-fatal.
    }
  }, []);

  const onToggleExpanded = useCallback(
    (id: ArtifactId) => {
      setExpanded((prev) => {
        const willExpand = !prev[id];
        if (willExpand) void fetchPayload(id);
        return { ...prev, [id]: willExpand };
      });
    },
    [fetchPayload],
  );

  const onTogglePin = useCallback(
    async (id: ArtifactId) => {
      await ipcClient().togglePinArtifact(id);
      await refresh();
    },
    [refresh],
  );

  // Surfaced when post_message rejects (subprocess down, validation, etc.).
  // Cleared on the next successful send. Suggestion mode never reappears
  // mid-session — once `hasStarted` is true the thread stays visible so
  // the user sees both their failed draft (still in the dock) and the
  // history of successful sends.
  const [sendError, setSendError] = useState<string | null>(null);
  // Track in-flight sends so the UI can disable the dock and avoid
  // double-dispatching the same draft. The compose dock clears its draft
  // on the synchronous return of `onSend`, so the user-facing optimistic
  // state lives here, gated by this flag.
  const [sending, setSending] = useState(false);
  // B7 — five-state activity model. We track three observable phases
  // today: idle / submitting (waiting for the first agent artifact) /
  // stuck (15s elapsed with no progress). Streaming-cursor + per-tool
  // spinner phases will land when the Rust core emits
  // `agent_streaming` / `tool_started` events — until then they're
  // architecturally cheap (just additional values for `activity`).
  type Activity = "idle" | "submitting" | "stuck";
  const [activity, setActivity] = useState<Activity>("idle");
  // Snapshot of the artifact count taken when we flipped to submitting.
  // The phase clears as soon as a new artifact lands beyond it.
  const submittedAtCountRef = useRef(0);
  const stuckTimerRef = useRef<number | null>(null);
  const STUCK_AFTER_MS = 15_000;
  // Synchronous re-entry guard. React `useState` updates are batched, so
  // two clicks within the same microtask will both observe the prior
  // `sending = false` if we gated on state alone. The ref is set
  // synchronously so a second click during the in-flight send
  // short-circuits before reaching `ipcClient().postMessage`.
  const sendingRef = useRef(false);
  // Mirror of `artifacts.length` kept in a ref so `onSend` doesn't
  // need `artifacts` in its dep list — otherwise every refresh would
  // recreate the callback identity and thrash any downstream memo on
  // ComposeDock.
  const artifactCountRef = useRef(0);
  artifactCountRef.current = artifacts?.length ?? 0;
  const onSend = useCallback(
    async (payload: ComposeSendPayload) => {
      if (!payload.text.trim() && payload.attachments.length === 0) return;
      if (sendingRef.current) return;
      sendingRef.current = true;
      setHasStarted(true);
      setSending(true);
      setSendError(null);
      // B7 — flip to "submitting" the moment the user clicks send. The
      // count snapshot lets the activity-clearing effect detect when a
      // new agent artifact has landed (count grows past the snapshot).
      submittedAtCountRef.current = artifactCountRef.current;
      setActivity("submitting");
      if (stuckTimerRef.current) window.clearTimeout(stuckTimerRef.current);
      stuckTimerRef.current = window.setTimeout(() => {
        setActivity((prev) => (prev === "submitting" ? "stuck" : prev));
      }, STUCK_AFTER_MS);
      try {
        await ipcClient().postMessage({
          workspace_id: workspace.id,
          text: payload.text,
          attachments: payload.attachments.map((a) => ({
            id: a.id,
            name: a.name,
            size: a.size,
          })),
        });
        // The backend coalescer streams the agent reply into the
        // workspace event log; the artifact-event listener above
        // refreshes the thread when those events arrive. We don't
        // append to local state here — the projector is the source
        // of truth and `refresh()` is idempotent.
      } catch (err) {
        setSendError(describeIpcError(err));
        // ComposeDock clears its own draft synchronously after onSend
        // returns. On failure we restore it so the user doesn't have to
        // retype — the failed text re-appears in the textarea and we
        // refocus so they can edit and resend. Backend guarantees no
        // user artifact lands when dispatch fails (see
        // `core_agents.rs::post_message`), so retrying with the same
        // text does not produce duplicates.
        composeRef.current?.setDraft(payload.text);
        composeRef.current?.focus();
        // Failure path: clear the activity indicator immediately —
        // the user is staring at an alert banner, not waiting for a
        // reply.
        if (stuckTimerRef.current) {
          window.clearTimeout(stuckTimerRef.current);
          stuckTimerRef.current = null;
        }
        setActivity("idle");
      } finally {
        sendingRef.current = false;
        setSending(false);
        // Always re-fetch — even on failure, an earlier successful
        // send may have produced a coalesced reply since the last poll.
        void refresh();
      }
    },
    [workspace.id, refresh],
  );

  // B7 — clear activity once a new agent artifact lands. The submitting
  // and stuck states both end the same way: the artifact list grew past
  // the snapshot we took when the user clicked send.
  useEffect(() => {
    const count = artifacts?.length ?? 0;
    if (activity !== "idle" && count > submittedAtCountRef.current) {
      // Look for an artifact authored by anyone other than the user,
      // landed after the snapshot. If there is one, the agent has
      // started replying — clear.
      const fresh = (artifacts ?? []).slice(submittedAtCountRef.current);
      const agentReplied = fresh.some(
        (a) =>
          a.author_role !== null &&
          a.author_role !== "user" &&
          a.author_role !== "you",
      );
      if (agentReplied) {
        if (stuckTimerRef.current) {
          window.clearTimeout(stuckTimerRef.current);
          stuckTimerRef.current = null;
        }
        setActivity("idle");
      }
    }
  }, [artifacts, activity]);

  // Clear the timer on unmount so we don't fire setActivity on a
  // disposed component.
  useEffect(
    () => () => {
      if (stuckTimerRef.current) window.clearTimeout(stuckTimerRef.current);
    },
    [],
  );

  // CC3 — keep relative timestamps fresh on long-idle threads. Without
  // this, a message that read "just now" on first render would stay
  // "just now" forever because no parent re-render would be triggered.
  // 30 s is fine-grained enough that the early "10s ago" → "1m ago"
  // transitions land sharply, but coarse enough that we're not
  // re-rendering for nothing. We force a re-render by toggling a tick
  // counter; the actual relative-time math reads the current clock.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => {
      setNowTick((n) => n + 1);
    }, 30_000);
    return () => window.clearInterval(id);
  }, []);

  const pickSuggestion = useCallback((text: string) => {
    composeRef.current?.setDraft(text);
    composeRef.current?.focus();
  }, []);

  const suggestions = useMemo(
    () => buildSuggestions(artifacts ?? []),
    [artifacts],
  );

  const showSuggestions = !hasStarted;

  // B6 — scroll stickiness. We pin the thread to the bottom whenever the
  // user is already at (or near) the bottom; we don't yank them down
  // when they've scrolled up to read history. A "Jump to latest" pill
  // appears once they're behind; clicking it re-pins.
  //
  // The threshold (32 px) is the standard "near the bottom" heuristic
  // used by Slack / iMessage / Linear comment threads. Less than that
  // and rendering rounding can flip stickiness on every micro-scroll.
  const threadRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const [behind, setBehind] = useState(false);
  // CC2 — suppress the per-child arrival animation for the very first
  // paint of this thread instance. Tab switches remount the whole
  // component, so without this gate every existing artifact re-runs
  // the slide-in animation and the surface looks like it's panicking.
  // Two RAFs: the first lets the initial paint commit with the
  // `--initial` class applied; the second clears it so subsequent
  // additions animate normally.
  const [initialPaint, setInitialPaint] = useState(true);
  useEffect(() => {
    const inner = { id: 0 };
    const r1 = window.requestAnimationFrame(() => {
      inner.id = window.requestAnimationFrame(() => setInitialPaint(false));
    });
    return () => {
      window.cancelAnimationFrame(r1);
      if (inner.id) window.cancelAnimationFrame(inner.id);
    };
  }, []);

  const onThreadScroll = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 32;
    stickRef.current = atBottom;
    setBehind(!atBottom);
  }, []);

  // useLayoutEffect runs synchronously after DOM mutations but before
  // the browser paints — the right hook for scroll positioning since it
  // avoids a visible flash at the wrong scroll position.
  useLayoutEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    if (stickRef.current) {
      el.scrollTop = el.scrollHeight;
      setBehind(false);
    }
  }, [artifacts?.length, hasStarted, sending]);

  const jumpToLatest = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    stickRef.current = true;
    setBehind(false);
  }, []);

  return (
    <div
      className="workspace-thread"
      data-component="WorkspaceThread"
      data-activity={activity}
    >
      {showSuggestions ? (
        <div className="thread thread--suggestions" aria-label="Starter suggestions">
          <ul className="suggestion-list" role="list">
            {suggestions.map((s) => (
              <li key={s}>
                <button
                  type="button"
                  className="suggestion-row"
                  onClick={() => pickSuggestion(s)}
                >
                  <span className="suggestion-row__label">{s}</span>
                  <ArrowRight
                    size={16}
                    strokeWidth={1.5}
                    className="suggestion-row__arrow"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="thread-wrap">
          <div
            ref={threadRef}
            className={`thread${initialPaint ? " thread--initial" : ""}`}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Workspace thread"
            onScroll={onThreadScroll}
          >
            {groupArtifacts(artifacts ?? []).map((unit) => {
              if (unit.kind === "group") {
                return (
                  <ToolCallGroup
                    key={`group:${unit.artifacts[0].id}`}
                    artifacts={unit.artifacts}
                  />
                );
              }
              const a = unit.artifact;
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
            {activity !== "idle" && (
              <ActivityIndicator activity={activity} />
            )}
          </div>
          {behind && (
            <button
              type="button"
              className="thread__jump-latest"
              data-component="JumpToLatest"
              onClick={jumpToLatest}
              aria-label="Jump to latest message"
            >
              <ArrowDown size={14} strokeWidth={1.75} aria-hidden="true" />
              <span>Jump to latest</span>
            </button>
          )}
        </div>
      )}
      <div className="workspace-thread__compose">
        {sendError && (
          <div className="workspace-thread__notice" role="alert">
            {sendError}
          </div>
        )}
        <ComposeDock
          ref={composeRef}
          onSend={onSend}
          placeholder={sending ? "Sending…" : undefined}
          busy={sending}
        />
      </div>
    </div>
  );
}

/**
 * B5 — coalesce consecutive tool-call (`report` kind) artifacts into a
 * single collapsed row. The default boxed ReportBlock turned a 7-step
 * tool sequence into 7 cards; the user lost the conversation in the
 * noise. Pattern matches Claude / ChatGPT / Cursor: "Searched the web
 * (3 results)" with a disclosure for the individual rows.
 *
 * Non-report artifacts pass through unchanged so the chat stays mixed.
 */
type RenderUnit =
  | { kind: "single"; artifact: ArtifactSummary }
  | { kind: "group"; artifacts: ArtifactSummary[] };

export function groupArtifacts(artifacts: ArtifactSummary[]): RenderUnit[] {
  const out: RenderUnit[] = [];
  let run: ArtifactSummary[] = [];
  const flushRun = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push({ kind: "single", artifact: run[0] });
    } else {
      out.push({ kind: "group", artifacts: run });
    }
    run = [];
  };
  for (const a of artifacts) {
    if (a.kind === "report") {
      run.push(a);
    } else {
      flushRun();
      out.push({ kind: "single", artifact: a });
    }
  }
  flushRun();
  return out;
}

function ToolCallGroup({ artifacts }: { artifacts: ArtifactSummary[] }) {
  const [expanded, setExpanded] = useState(false);
  const verbList = artifacts.map((a) => a.title).slice(0, 4);
  const remainder = artifacts.length - verbList.length;
  const summary =
    remainder > 0
      ? `${verbList.join(", ")} and ${remainder} more`
      : verbList.join(", ");
  return (
    <div
      className="tool-group"
      data-component="ToolCallGroup"
      data-expanded={expanded}
    >
      <button
        type="button"
        className="tool-group__head"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <ChevronRight
          size={14}
          strokeWidth={1.75}
          className="tool-group__chevron"
          aria-hidden="true"
        />
        <Wrench
          size={14}
          strokeWidth={1.75}
          className="tool-group__icon"
          aria-hidden="true"
        />
        <span className="tool-group__count">
          Used {artifacts.length} tools
        </span>
        <span className="tool-group__verbs">{summary}</span>
      </button>
      {expanded && (
        <ul className="tool-group__list" role="list">
          {artifacts.map((a) => (
            <li key={a.id} className="tool-group__row">
              <span className="tool-group__row-title">{a.title}</span>
              {a.summary && a.summary !== a.title && (
                <span className="tool-group__row-summary">{a.summary}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * B7 — visible feedback for the agent's working state. Three observable
 * phases today (more land when the Rust core emits streaming events):
 *
 *   submitting — the user just sent; we're waiting for the first reply
 *   stuck      — 15s elapsed without any agent artifact appearing
 *
 * The dots use the existing `--motion-pulse` token; reduced-motion
 * collapses them to static glyphs (no animation override needed —
 * `--motion-pulse` itself respects the media query at the token layer).
 */
function ActivityIndicator({
  activity,
}: {
  activity: "submitting" | "stuck";
}) {
  const label =
    activity === "stuck"
      ? "Still working — this is taking longer than usual"
      : "Designer is thinking";
  // `role="status"` carries an implicit `aria-live="polite"`, and the
  // indicator already lives inside the thread's `role="log"` region;
  // declaring `aria-live` again would either duplicate the announcement
  // or get ignored by AT depending on the engine. Stick with the role
  // alone. data-state is the visual hook; aria-label gives AT the text
  // even when the dot row is hidden by reduced-motion.
  return (
    <div
      className="thread__activity"
      data-component="ActivityIndicator"
      data-state={activity}
      role="status"
      aria-label={label}
    >
      <span className="thread__activity-dots" aria-hidden="true">
        <span />
        <span />
        <span />
      </span>
      <span className="thread__activity-label">{label}</span>
    </div>
  );
}
