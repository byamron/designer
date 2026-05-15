import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ArrowDown, ArrowRight } from "lucide-react";
import {
  ComposeDock,
  type ComposeDockHandle,
  type ComposeSendPayload,
} from "../components/ComposeDock";
import { getBlockRenderer, GenericBlock } from "../blocks";
import type { TabId, Workspace } from "../ipc/types";
import type {
  ArtifactDetail,
  ArtifactId,
  ArtifactSummary,
  PayloadRef,
} from "../ipc/types";
import { ipcClient } from "../ipc/client";
import { describeIpcError } from "../ipc/error";
import {
  appStore,
  clearQueuedMessage,
  markTabStarted,
  setTabDraft,
  useAppState,
} from "../store/app";
import { activityKey, useDataState } from "../store/data";
import {
  currentOpenTurn,
  subprocessKey,
  useChatThreadState,
} from "../store/chatThread";
import { useFlag, useEnsureFlagsLoaded } from "../store/flags";
import { ChatStreamRenderer } from "../blocks/ChatStreamRenderer";
import { planAutoName } from "../util/autoname";
import { refreshWorkspaces } from "../store/data";
import "../blocks";

/**
 * Default suggestions for a fresh / empty tab. Per-tab thread isolation
 * means an empty tab always reads as a fresh start: even when the
 * workspace as a whole has artifacts (specs, PRs, prior threads in
 * other tabs), THIS tab is empty until the user posts here. The
 * dynamic, workspace-aware variant of these suggestions is a v2
 * follow-up — it needs a `LocalOps::suggest_tab_seeds` call and a
 * meaningful spec, and shipping a static "dynamic" copy change would
 * be the same half-baked-feature trap PR #70 closed.
 */
const STARTER_SUGGESTIONS = [
  "What are we building?",
  "Describe the feature in one paragraph",
  "Paste a spec, diagram, or wireframe",
  "Review the recent activity and suggest next steps",
];

/** Suggestions for a tab whose thread is empty.
 *
 *  Pre-isolation, this function tried to derive context-aware prompts
 *  from the workspace's `artifacts` (latest spec / PR / approval). With
 *  per-tab isolation, the tab's `artifacts` slice is empty when the
 *  tab is empty, so that branch collapsed to a single "Describe
 *  something new" entry — the friction the user reported. We now
 *  return the static starter set every time. The richer, "dynamic
 *  from workspace context" mode is deferred to a v2 follow-up
 *  (`suggest_tab_seeds` LocalOps op + UX spec).
 *
 *  **Dead-by-design, not dead code.** The `_artifacts` parameter is
 *  intentionally unread — the function is kept (not inlined) as the
 *  obvious seam for the v2 dynamic-suggestions wiring. When v2 lands,
 *  drop the underscore and read the slice; callers and tests stay
 *  unchanged.
 */
function buildSuggestions(_artifacts: ArtifactSummary[]): string[] {
  return STARTER_SUGGESTIONS;
}

/**
 * Per frc_019dea6a-9278 — after the user's first message lands, rename
 * the active tab (and workspace, when applicable) from the placeholder
 * `Tab N` / `Workspace N` to a short title derived from the message
 * body. Idempotent via the default-name gate: once a name has been
 * customized (manually or by this function), subsequent messages
 * leave it alone. Refreshes the workspace projection on success so
 * the sidebar reflects the new name immediately.
 *
 * Errors are logged, never thrown — auto-naming is a quality-of-life
 * affordance and must never interfere with message delivery.
 */
async function autoRenameOnFirstMessage(args: {
  workspaceId: string;
  workspaceName: string;
  tabId: TabId | undefined;
  tabTitle: string | null;
  text: string;
  onAnnounce?: (title: string) => void;
}): Promise<void> {
  const plan = planAutoName({
    workspaceName: args.workspaceName,
    tabTitle: args.tabTitle,
    text: args.text,
  });
  if (!plan) return;
  const tasks: Promise<unknown>[] = [];
  if (plan.renameWorkspace) {
    tasks.push(
      ipcClient()
        .renameWorkspace(args.workspaceId, plan.title)
        .catch((err) => console.warn("auto-rename workspace failed", err)),
    );
  }
  if (plan.renameTab && args.tabId) {
    tasks.push(
      ipcClient()
        .renameTab(args.workspaceId, args.tabId, plan.title)
        .catch((err) => console.warn("auto-rename tab failed", err)),
    );
  }
  if (tasks.length === 0) return;
  await Promise.all(tasks);
  // Polite SR announcement so users who can't see the sidebar update
  // hear that the rename happened (per PR #139 staff-review UX BLOCKER).
  // Sighted users see the sidebar text swap; this restores parity.
  args.onAnnounce?.(plan.title);
  try {
    const projectId = appStore.get().activeProject;
    if (projectId) await refreshWorkspaces(projectId);
  } catch (err) {
    console.warn("auto-rename refresh failed", err);
  }
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
export function WorkspaceThread({
  workspace,
  tabId,
}: {
  workspace: Workspace;
  // Active tab id. Per-tab thread isolation: WorkspaceThread reads
  // only this tab's slice of the workspace artifact pool. Optional so
  // existing component-level vitest renders that don't care about per-
  // tab state can still mount the thread without scaffolding a
  // workspace + tab pair; in production every caller (MainView) passes
  // the active tab id and the per-tab `listArtifactsInTab` filter
  // applies.
  tabId?: TabId;
}) {
  const stateKey: TabId = (tabId ?? `__default__:${workspace.id}`) as TabId;
  // Phase 24 (ADR 0008) — flag-gated branch into the new chat surface.
  // Hooks fire unconditionally regardless of the flag's value to keep
  // React's hooks-order invariant. The decision to render
  // ChatStreamRenderer vs. the legacy artifact list happens at render
  // time below; both branches share the surrounding ComposeDock.
  useEnsureFlagsLoaded();
  const showChatV2 = useFlag("show_chat_v2");
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null);
  const [payloads, setPayloads] = useState<Record<ArtifactId, PayloadRef>>({});
  const [expanded, setExpanded] = useState<Record<ArtifactId, boolean>>({});
  // A freshly mounted tab starts in "suggest" mode — shows roadmap /
  // recent-activity prompts instead of the thread. First send (or first
  // suggestion pick) flips it to "thread" mode and that flip persists in
  // the app store keyed by tab id. The lazy initializer reads from the
  // store synchronously so a re-mount of an already-started tab paints
  // the thread on the very first frame — no flash of the suggestion
  // strip on tab switch (the tab-switch flash friction report).
  const [hasStarted, setHasStartedLocal] = useState(
    () => !!appStore.get().tabStartedById[stateKey],
  );
  // Phase 23.D fixed tab switches to keep WorkspaceThread mounted across
  // `tabId` changes (no more remount). Without this resync, the local
  // `hasStarted` snapshot taken on first mount sticks forever — opening
  // a fresh tab while a sibling was started would inherit the sibling's
  // `true` and skip the suggestion strip on the empty tab. Re-read from
  // the store every time `stateKey` changes so the empty-state cue
  // appears for tabs the user hasn't started yet.
  useEffect(() => {
    setHasStartedLocal(!!appStore.get().tabStartedById[stateKey]);
  }, [stateKey]);
  const setHasStarted = (next: boolean) => {
    setHasStartedLocal(next);
    if (next) markTabStarted(stateKey);
  };
  // Same pattern for the composer draft — read the saved draft from
  // the store before paint so a tab switch back doesn't flash an empty
  // textarea (the draft-loss friction report). ComposeDock fires
  // onDraftChange on every keystroke so the store stays current.
  const initialDraft = useMemo(
    () => appStore.get().composerDraftByTab[stateKey] ?? "",
    [stateKey],
  );
  const composeRef = useRef<ComposeDockHandle | null>(null);

  const refresh = useCallback(async () => {
    // Per-tab thread isolation: when we know the active tab, ask the
    // backend for the tab's slice (workspace-wide artifacts plus only
    // this tab's messages). Falling back to the workspace-wide list
    // keeps tests + callers that don't know about tabs working.
    const next = tabId
      ? await ipcClient().listArtifactsInTab(workspace.id, tabId)
      : await ipcClient().listArtifacts(workspace.id);
    setArtifacts(next);
  }, [workspace.id, tabId]);

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

  // Per-tab state. Phase 23.D keeps `WorkspaceThread` mounted across
  // tab switches, so a single `activity` / `sending` / `sendError`
  // would leak: a turn in flight on tab A would keep the "Designer is
  // thinking" indicator and the dock's busy lockout painted on tab B
  // after the user switched. Key these by `stateKey` and read the
  // current tab's slice on render. The closures below capture the
  // stateKey at the moment of send, so a send that started on A
  // resolves to A even if the user has switched to B in the meantime.
  type Activity = "idle" | "submitting" | "stuck";
  const [sendErrorByTab, setSendErrorByTab] = useState<
    Record<string, string | null>
  >({});
  const [sendingByTab, setSendingByTab] = useState<Record<string, boolean>>({});
  const [activityByTab, setActivityByTab] = useState<Record<string, Activity>>(
    {},
  );
  const sendError = sendErrorByTab[stateKey] ?? null;
  const sending = sendingByTab[stateKey] ?? false;
  const activity = activityByTab[stateKey] ?? "idle";
  // Refs keyed the same way. Mutating these does not trigger a re-
  // render — they store the per-tab snapshot the async send loop
  // refers back to.
  const submittedAtCountByTab = useRef<Record<string, number>>({});
  const stuckTimerByTab = useRef<Record<string, number | null>>({});
  // Synchronous re-entry guard. React `useState` updates are batched,
  // so two clicks within the same microtask both observe the prior
  // `sending = false` if we gated on state alone. The ref is set
  // synchronously so a second click on the *same tab* during the in-
  // flight send short-circuits before reaching `postMessage`.
  const sendingRefByTab = useRef<Record<string, boolean>>({});
  const STUCK_AFTER_MS = 15_000;
  // Mirror of `artifacts.length` kept in a ref so `onSend` doesn't
  // need `artifacts` in its dep list — otherwise every refresh would
  // recreate the callback identity and thrash any downstream memo on
  // ComposeDock.
  const artifactCountRef = useRef(0);
  artifactCountRef.current = artifacts?.length ?? 0;
  // Tiny helpers so the send loop reads cleanly. Each writes the
  // entry for `key` (the stateKey captured at send time, NOT the
  // currently visible stateKey).
  const setSendErrorFor = (key: string, value: string | null) =>
    setSendErrorByTab((prev) => ({ ...prev, [key]: value }));
  const setSendingFor = (key: string, value: boolean) =>
    setSendingByTab((prev) => ({ ...prev, [key]: value }));
  const setActivityFor = (
    key: string,
    next: Activity | ((prev: Activity) => Activity),
  ) =>
    setActivityByTab((prev) => {
      const current = prev[key] ?? "idle";
      const value = typeof next === "function" ? next(current) : next;
      if (current === value) return prev;
      return { ...prev, [key]: value };
    });
  // frc_019dea6a-9278 — session-level guard against the second-message
  // race surfaced in PR #139 staff-review. The closure inside onSend
  // captures workspace.name; if the user sends a second message before
  // the first rename's refreshWorkspaces propagates, the closure still
  // sees "Workspace 1" and the default-name regex gate would fire a
  // second rename with the second message's derived title. This ref
  // short-circuits the call before it reaches the gate, ensuring auto-
  // rename runs at most once per workspace / tab per session.
  const autoRenamedRef = useRef<Set<string>>(new Set());
  // frc_019dea6a-9278 — polite SR announcement when auto-rename
  // fires. Sighted users see the sidebar text swap from
  // "Workspace N" to the derived title; this restores parity for
  // screen-reader users. Cleared after 1.5s so the same string
  // doesn't linger on unrelated re-renders.
  const [renameAnnouncement, setRenameAnnouncement] = useState("");
  const renameAnnouncementTimerRef = useRef<number | null>(null);
  const announceAutoRename = useCallback((title: string) => {
    setRenameAnnouncement(`Renamed to ${title}.`);
    if (renameAnnouncementTimerRef.current) {
      window.clearTimeout(renameAnnouncementTimerRef.current);
    }
    renameAnnouncementTimerRef.current = window.setTimeout(() => {
      setRenameAnnouncement("");
      renameAnnouncementTimerRef.current = null;
    }, 1500);
  }, []);
  useEffect(
    () => () => {
      if (renameAnnouncementTimerRef.current) {
        window.clearTimeout(renameAnnouncementTimerRef.current);
      }
    },
    [],
  );
  const onSend = useCallback(
    async (payload: ComposeSendPayload) => {
      if (!payload.text.trim() && payload.attachments.length === 0) return;
      // Capture the stateKey at click time so every subsequent state
      // mutation in this closure (success or failure) lands on the tab
      // the user actually sent from — even if they switch tabs while
      // the send is in flight. `stateKey` here is React's closed-over
      // value at the moment the callback was created (which is keyed
      // off the current tabId, kept fresh by the dependency array).
      const sendKey = stateKey;
      if (sendingRefByTab.current[sendKey]) return;
      sendingRefByTab.current[sendKey] = true;
      setHasStarted(true);
      setSendingFor(sendKey, true);
      setSendErrorFor(sendKey, null);
      // B7 — flip to "submitting" the moment the user clicks send. The
      // count snapshot lets the activity-clearing effect detect when a
      // new agent artifact has landed (count grows past the snapshot).
      submittedAtCountByTab.current[sendKey] = artifactCountRef.current;
      setActivityFor(sendKey, "submitting");
      const existingTimer = stuckTimerByTab.current[sendKey];
      if (existingTimer) window.clearTimeout(existingTimer);
      stuckTimerByTab.current[sendKey] = window.setTimeout(() => {
        setActivityFor(sendKey, (prev) =>
          prev === "submitting" ? "stuck" : prev,
        );
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
          // Per-tab thread isolation: scope the message to the
          // active tab so the projector files it under this tab's
          // thread only.
          tab_id: tabId,
          // Per-message model selection (frontend identifier — Rust
          // maps to the Claude CLI `--model` arg). Switching models
          // respawns the team in core_agents.
          model: payload.meta.model,
        });
        // The backend coalescer streams the agent reply into the
        // workspace event log; the artifact-event listener above
        // refreshes the thread when those events arrive. We don't
        // append to local state here — the projector is the source
        // of truth and `refresh()` is idempotent.

        // frc_019dea6a-9278 — first-message auto-naming. If the
        // current workspace or tab still carries its default
        // `Workspace N` / `Tab N` name, derive a short title from
        // this message and rename. Fire-and-forget: a rename failure
        // must never surface above the actual conversation. The
        // default-name gate makes this idempotent — once renamed
        // (either manually or by this path), subsequent messages
        // skip the call.
        const autoRenameKey = `${workspace.id}:${tabId ?? ""}`;
        if (!autoRenamedRef.current.has(autoRenameKey)) {
          autoRenamedRef.current.add(autoRenameKey);
          void autoRenameOnFirstMessage({
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            tabId,
            tabTitle:
              workspace.tabs.find((t) => t.id === tabId)?.title ?? null,
            text: payload.text,
            onAnnounce: announceAutoRename,
          });
        }
      } catch (err) {
        setSendErrorFor(sendKey, describeIpcError(err));
        // ComposeDock clears its own draft synchronously after onSend
        // returns. On failure we restore it so the user doesn't have to
        // retype — the failed text re-appears in the textarea and we
        // refocus so they can edit and resend. Backend guarantees no
        // user artifact lands when dispatch fails (see
        // `core_agents.rs::post_message`), so retrying with the same
        // text does not produce duplicates. Only restore + refocus
        // when the user is still on the tab they sent from; if they
        // switched tabs we leave the destination tab alone.
        if (sendKey === stateKey) {
          composeRef.current?.setDraft(payload.text);
          composeRef.current?.focus();
        }
        // Failure path: clear the activity indicator immediately for
        // the originating tab — the user is staring at an alert
        // banner, not waiting for a reply.
        const t = stuckTimerByTab.current[sendKey];
        if (t) {
          window.clearTimeout(t);
          stuckTimerByTab.current[sendKey] = null;
        }
        setActivityFor(sendKey, "idle");
      } finally {
        sendingRefByTab.current[sendKey] = false;
        setSendingFor(sendKey, false);
        // Always re-fetch — even on failure, an earlier successful
        // send may have produced a coalesced reply since the last poll.
        void refresh();
      }
    },
    [workspace.id, tabId, stateKey, refresh, announceAutoRename],
  );

  // Phase 24 §5.4 — auto-dispatch the queued message when the
  // subprocess for the focused tab transitions from working /
  // awaiting_approval → idle. Same observable signal the
  // ComposeDockActivityRow uses to derive `subprocess_running`. The
  // ⌘⏎ stop-and-send path lands here too — the interrupt RPC ends the
  // turn, the AgentTurnEnded { Interrupted } flips this signal idle,
  // and we dispatch the queue (via the same onSend handler used by
  // immediate sends).
  //
  // V1 limitation: dispatch only fires for the active tab. If the user
  // switches tabs mid-stream and the inactive tab's turn finishes, the
  // queue persists but doesn't auto-fire — the user sees the chip when
  // they switch back and can re-send manually. Out-of-active-tab auto-
  // dispatch needs a global watcher; deferred to a follow-up if dogfood
  // surfaces the gap.
  const phase24OpenForCurrentTab = useChatThreadState((s) => {
    if (!showChatV2 || !tabId) return false;
    if (!currentOpenTurn(s.byTab[tabId])) return false;
    return s.runningSubprocesses.has(subprocessKey(workspace.id, tabId));
  });
  const legacyActivity = useDataState(
    (s) => s.activity[activityKey(workspace.id, tabId)],
  );
  const subprocessActiveForCurrentTab = showChatV2
    ? phase24OpenForCurrentTab
    : legacyActivity?.state === "working" ||
      legacyActivity?.state === "awaiting_approval";
  const queuedMessage = useAppState((s) =>
    tabId ? s.queuedMessageByTab[tabId] : undefined,
  );
  const prevSubprocessActiveRef = useRef(false);
  // Phase 24 §5.4 — transient SR announcement on queue dispatch. Rendered
  // into a sr-only `role="status" aria-live="polite"` region so screen
  // readers hear the dispatch event (the chip removal alone is silent).
  // Cleared after 1.5 s so the same string doesn't linger and re-announce
  // on unrelated re-renders. v1 uses one string for both queue and
  // stop-and-send paths — the user's keypress already disambiguated the
  // intent; the announcement just confirms the message went out.
  const [queueAnnouncement, setQueueAnnouncement] = useState("");
  useEffect(() => {
    const wasActive = prevSubprocessActiveRef.current;
    prevSubprocessActiveRef.current = subprocessActiveForCurrentTab;
    if (!tabId) return;
    if (!wasActive) return; // No transition to dispatch on.
    if (subprocessActiveForCurrentTab) return; // Still active.
    if (!queuedMessage) return; // No queue to dispatch.
    // Snapshot the queue body, clear it before dispatch so a
    // re-render mid-flight doesn't see the chip linger past the
    // dispatch. onSend is async; failures restore the draft via the
    // existing catch-handler in the onSend body, but the queue is
    // intentionally not re-saved on failure (the user gets a draft
    // they can edit + retry, not another silent queue). This matches
    // the spec §5.4 dispatch line: "if the prior turn errored, the
    // user can retry by editing in the new turn."
    const text = queuedMessage;
    clearQueuedMessage(tabId);
    setQueueAnnouncement("Queued message sent.");
    const t = window.setTimeout(() => setQueueAnnouncement(""), 1500);
    void onSend({
      text,
      attachments: [],
      meta: { model: "opus-4.7", effort: "medium", planMode: false },
    });
    return () => window.clearTimeout(t);
  }, [subprocessActiveForCurrentTab, queuedMessage, tabId, onSend]);

  // Phase 24 §5.7 — assertive SR announcement on agent interrupt. The
  // visible InterruptedMarker mounts conditionally; conditional mount of
  // a `role="status"` region is unreliable for screen readers (same
  // failure pattern as the queue-chip removal — see
  // feedback_aria_live_for_spec_announcements memory). A separate
  // long-lived `aria-live="assertive"` region with text that changes
  // when a new turn becomes interrupted produces the announcement.
  const interruptedTurnIds = useChatThreadState((s) => {
    if (!showChatV2 || !tabId) return undefined;
    const tabState = s.byTab[tabId];
    if (!tabState) return undefined;
    const ids: string[] = [];
    for (const turn of Object.values(tabState.turns)) {
      if (turn.stop_reason === "interrupted") ids.push(turn.turn_id);
    }
    return ids.join(",");
  });
  const announcedInterruptsRef = useRef<Set<string>>(new Set());
  const [interruptAnnouncement, setInterruptAnnouncement] = useState("");
  useEffect(() => {
    if (!interruptedTurnIds) return;
    const ids = interruptedTurnIds ? interruptedTurnIds.split(",").filter(Boolean) : [];
    let announced = false;
    for (const id of ids) {
      if (!announcedInterruptsRef.current.has(id)) {
        announcedInterruptsRef.current.add(id);
        announced = true;
      }
    }
    if (!announced) return;
    setInterruptAnnouncement("Agent interrupted.");
    const t = window.setTimeout(() => setInterruptAnnouncement(""), 1500);
    return () => window.clearTimeout(t);
  }, [interruptedTurnIds]);

  // Phase 24 §5.7 row 275 — assertive SR announcement on
  // `AgentTurnEnded { stop_reason: Error }`. Carries the §5.6
  // user-facing copy verbatim so the screen-reader user hears the
  // same message a sighted user reads on the inline ErrorMarker.
  // Same pattern as `interruptAnnouncement` above: long-lived live
  // region with text that changes when a new turn becomes errored.
  // Tracked-by-turn-id ref so each errored turn announces exactly
  // once even if the component re-renders.
  const erroredTurnIds = useChatThreadState((s) => {
    if (!showChatV2 || !tabId) return undefined;
    const tabState = s.byTab[tabId];
    if (!tabState) return undefined;
    const ids: string[] = [];
    for (const turn of Object.values(tabState.turns)) {
      if (turn.stop_reason === "error") ids.push(turn.turn_id);
    }
    return ids.join(",");
  });
  const announcedErrorsRef = useRef<Set<string>>(new Set());
  const [errorAnnouncement, setErrorAnnouncement] = useState("");
  useEffect(() => {
    if (!erroredTurnIds) return;
    const ids = erroredTurnIds ? erroredTurnIds.split(",").filter(Boolean) : [];
    let announced = false;
    for (const id of ids) {
      if (!announcedErrorsRef.current.has(id)) {
        announcedErrorsRef.current.add(id);
        announced = true;
      }
    }
    if (!announced) return;
    setErrorAnnouncement(
      "Agent stopped: something went wrong on Claude’s side. Try again, or shorten the request.",
    );
    const t = window.setTimeout(() => setErrorAnnouncement(""), 2000);
    return () => window.clearTimeout(t);
  }, [erroredTurnIds]);

  // B7 — clear activity once a new agent artifact lands. The submitting
  // and stuck states both end the same way: the artifact list grew past
  // the snapshot we took when the user clicked send. The snapshot is
  // per-tab so this only resolves the indicator for tabs that have a
  // pending send; other tabs' activity entries are untouched.
  useEffect(() => {
    if (activity === "idle") return;
    const count = artifacts?.length ?? 0;
    const snapshot = submittedAtCountByTab.current[stateKey] ?? 0;
    if (count <= snapshot) return;
    // Look for an artifact authored by anyone other than the user,
    // landed after the snapshot. If there is one, the agent has
    // started replying for THIS tab — clear.
    const fresh = (artifacts ?? []).slice(snapshot);
    const agentReplied = fresh.some(
      (a) =>
        a.author_role !== null &&
        a.author_role !== "user" &&
        a.author_role !== "you",
    );
    if (agentReplied) {
      const t = stuckTimerByTab.current[stateKey];
      if (t) {
        window.clearTimeout(t);
        stuckTimerByTab.current[stateKey] = null;
      }
      setActivityFor(stateKey, "idle");
    }
    // setActivityFor is identity-stable; safe to omit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artifacts, activity, stateKey]);

  // Clear all per-tab stuck timers on unmount so we don't fire
  // setActivity on a disposed component.
  useEffect(
    () => () => {
      const timers = stuckTimerByTab.current;
      for (const key of Object.keys(timers)) {
        const t = timers[key];
        if (t) window.clearTimeout(t);
      }
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
  // Programmatic-scroll guard. We flip this ref true around any scrollTop
  // assignment we initiate, then drop it on the next microtask after the
  // scroll event has dispatched. The legacy path got away without this
  // because writes happened inside useLayoutEffect (pre-paint, single
  // flush boundary); chat-v2 streams via store-subscription updates and
  // ResizeObserver callbacks that don't share the same flush, so a
  // natural scroll event from a re-pin can race a content-growth event
  // and flip stickRef false. Bail in onThreadScroll when the guard is up.
  const programmaticScrollRef = useRef(false);
  const [behind, setBehind] = useState(false);
  // CC2 — suppress the per-child arrival animation for the very first
  // paint of this thread instance, and again whenever the active tab
  // changes (Phase 23.D keeps the component mounted across tab switches,
  // so a `tabId` change swaps the artifact list in place; without
  // re-arming the gate every artifact in the new tab's view animates
  // in like it just landed and the surface looks like it's panicking).
  // Two RAFs: the first lets the initial paint commit with the
  // `--initial` class applied; the second clears it so subsequent
  // additions animate normally.
  const [initialPaint, setInitialPaint] = useState(true);
  useEffect(() => {
    setInitialPaint(true);
    const inner = { id: 0 };
    const r1 = window.requestAnimationFrame(() => {
      inner.id = window.requestAnimationFrame(() => setInitialPaint(false));
    });
    return () => {
      window.cancelAnimationFrame(r1);
      if (inner.id) window.cancelAnimationFrame(inner.id);
    };
  }, [tabId]);

  const onThreadScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    const el = threadRef.current;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    const atBottom = distance < 32;
    stickRef.current = atBottom;
    setBehind(!atBottom);
  }, []);

  const pinToBottom = useCallback(() => {
    const el = threadRef.current;
    if (!el) return;
    programmaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    setBehind(false);
    // Clear the guard on the next microtask, after the synchronous
    // scroll event (if any) has dispatched. Using queueMicrotask
    // rather than setTimeout keeps the guard tight — we don't want
    // to swallow real user scroll events that arrive on the same tick.
    queueMicrotask(() => {
      programmaticScrollRef.current = false;
    });
  }, []);

  // useLayoutEffect runs synchronously after DOM mutations but before
  // the browser paints — the right hook for scroll positioning since it
  // avoids a visible flash at the wrong scroll position. The legacy
  // (artifact-list) path triggers on artifact arrival; chat-v2 height
  // changes within a streaming block are caught by the ResizeObserver
  // below since artifact-list deps don't observe store updates inside
  // a single chat row.
  useLayoutEffect(() => {
    if (stickRef.current) pinToBottom();
  }, [artifacts?.length, hasStarted, sending, pinToBottom]);

  // ResizeObserver pins on inner-content height growth. Required for
  // chat-v2 streaming: AgentContentBlockDelta extends an open block's
  // text without changing any value WorkspaceThread subscribes to, so
  // useLayoutEffect above can't catch it. Observing the scroll
  // container's first element child captures both the legacy artifact
  // list (.thread > items) and the chat-v2 stream (.thread__stream
  // inside .thread--phase24) without branching on the flag here.
  //
  // `bootReplaying` is in the deps so the observer re-binds when the
  // chat-v2 surface flips from <LoadingState/> to the populated
  // <div className="thread__stream">. Without this, a tab that boots
  // into replay would observe the small LoadingState div and, when it
  // unmounted, lose the binding — the populated thread arrives
  // unobserved and the initial pin-to-bottom never fires. Re-running
  // the effect tears down the old RO and creates a new one; the new
  // observer's first callback fires with the populated child's size,
  // which triggers `pinToBottom` while `stickRef` is still its default
  // `true` value. (UX reviewer caught this on 24H-W1a; the fix is a
  // single-line dep addition.)
  const bootReplaying = useChatThreadState((s) => s.bootReplaying);
  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    const content = el.firstElementChild;
    if (!(content instanceof Element)) return;
    const ro = new ResizeObserver(() => {
      if (stickRef.current) pinToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [pinToBottom, showChatV2, hasStarted, bootReplaying]);

  const jumpToLatest = useCallback(() => {
    stickRef.current = true;
    pinToBottom();
  }, [pinToBottom]);

  return (
    <div
      className="workspace-thread"
      data-component="WorkspaceThread"
      data-activity={activity}
    >
      {showChatV2 ? (
        // Phase 24 chat surface. The new renderer subscribes to the
        // per-tab chatThreadStore directly. Scroll-stickiness + the
        // Jump-to-latest pill are threaded through here at the
        // container altitude (same pattern as the legacy branch
        // below) so chat-v2 doesn't regress against the affordance
        // users learned in v1. ComposeDock is rendered below and is
        // shared between modes.
        <div className="thread-wrap">
          <div
            ref={threadRef}
            className="thread thread--phase24"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            aria-label="Workspace thread"
            onScroll={onThreadScroll}
          >
            <ChatStreamRenderer
              workspaceId={workspace.id}
              tabId={(tabId ?? stateKey) as TabId}
            />
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
      ) : showSuggestions ? (
        <div
          className="thread thread--suggestions"
          aria-label="Starter suggestions"
        >
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
            {(artifacts ?? []).map((a) => {
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
            {activity !== "idle" && <ActivityIndicator activity={activity} />}
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
        {/* Per-tab compose state. Phase 23.D kept WorkspaceThread mounted
            across `tabId` changes; ComposeDock owns its own `draft`,
            attachments, model and effort selections, all of which should
            belong to the active tab — not the previous one. Keying by
            `stateKey` remounts the dock per tab so the textarea reads
            the tab's saved draft from `initialDraft` on each switch and
            attachments + model don't bleed across tabs. The draft is
            written back via `onDraftChange` keyed by the same stateKey,
            so the round-trip A→B→A still restores A's text. */}
        <ComposeDock
          key={stateKey}
          ref={composeRef}
          onSend={onSend}
          placeholder={sending ? "Sending…" : undefined}
          busy={sending}
          initialDraft={initialDraft}
          onDraftChange={(text) => setTabDraft(stateKey, text)}
          workspaceId={workspace.id}
          tabId={tabId ?? null}
        />
        {/* Phase 24 §5.4 — sr-only live region for queue dispatch.
            The chip's removal alone is silent for screen readers; this
            announces the dispatch event explicitly. Visually hidden via
            the .sr-only utility (clip-path + position:absolute pattern). */}
        <span
          className="sr-only"
          role="status"
          aria-live="polite"
          data-component="QueueAnnouncement"
        >
          {queueAnnouncement}
        </span>
        {/* frc_019dea6a-9278 — sr-only live region for auto-rename.
            Sighted users see the sidebar text swap; this announces it
            for screen-reader users so they hear the workspace / tab
            title change after their first message. */}
        <span
          className="sr-only"
          role="status"
          aria-live="polite"
          data-component="RenameAnnouncement"
        >
          {renameAnnouncement}
        </span>
        {/* Phase 24 §5.7 — assertive announcement on
            AgentTurnEnded { stop_reason: Interrupted }. Spec table:
            thread region · assertive · "Agent interrupted". No
            `role="alert"` — that would collide with banner-style
            alerts (e.g. cost-cap). aria-live="assertive" alone is
            the announcement contract. */}
        <span
          className="sr-only"
          aria-live="assertive"
          data-component="InterruptAnnouncement"
        >
          {interruptAnnouncement}
        </span>
        {/* Phase 24 §5.7 row 275 — assertive announcement on
            AgentTurnEnded { stop_reason: Error }. Carries the §5.6
            user-facing copy verbatim. Sibling region to
            InterruptAnnouncement above; same contract. */}
        <span
          className="sr-only"
          aria-live="assertive"
          data-component="ErrorAnnouncement"
        >
          {errorAnnouncement}
        </span>
      </div>
    </div>
  );
}

/**
 * B7 — visible feedback for the agent's working state. Two observable
 * phases today (more land when the Rust core emits streaming events):
 *
 *   submitting — the user just sent; we're waiting for the first reply
 *   stuck      — 15s elapsed without any agent artifact appearing
 *
 * The visual is a compact single-character braille spinner — one dot
 * traversing the 8 positions of the braille cell on a tight loop. Reads
 * as motion-along-a-path at one-character width, replacing the prior
 * three 8-px dot row that crowded the thread. CSS-driven via a
 * `::before { content: ... }` keyframe so React holds no animation
 * state. Reduced-motion swaps the spinner for a static glyph.
 */
function ActivityIndicator({ activity }: { activity: "submitting" | "stuck" }) {
  const label =
    activity === "stuck"
      ? "Still working — this is taking longer than usual"
      : "Designer is thinking";
  // `role="status"` carries an implicit `aria-live="polite"`, and the
  // indicator already lives inside the thread's `role="log"` region;
  // declaring `aria-live` again would either duplicate the announcement
  // or get ignored by AT depending on the engine. Stick with the role
  // alone. data-state is the visual hook; aria-label gives AT the text
  // even when the spinner is hidden by reduced-motion.
  return (
    <div
      className="thread__activity"
      data-component="ActivityIndicator"
      data-state={activity}
      role="status"
      aria-label={label}
    >
      <span className="thread__activity-spinner" aria-hidden="true" />
      <span className="thread__activity-label">{label}</span>
    </div>
  );
}
