//! AppCore methods for Phase 13.D — agent wire.
//!
//! Owns the user-prompt → Claude-Code path: persists the user's message as
//! both a `MessagePosted` event and an `ArtifactCreated { kind: "message" }`
//! artifact, dispatches the body to the orchestrator, and runs a background
//! coalescer that turns streamed agent replies into `message` artifacts with
//! a 120 ms idle threshold (per ADR 0001 / ADR 0003 §"per-track scope").
//!
//! Conventions (see `CLAUDE.md` §"Parallel track conventions"):
//! - Method bodies live here; IPC handlers live in `commands_agents.rs`.
//! - Cross-track hooks marked `// TODO(13.X):`.
//! - Coalescer poll cadence is 30 ms; flush threshold is `coalesce_window`.
//!   The default 120 ms is the "feels live but doesn't churn" bar from
//!   integration-notes.md §12.A; tests override to a few ms via the
//!   `DESIGNER_MESSAGE_COALESCE_MS` env var.

use crate::core::AppCore;
use designer_claude::{OrchestratorError, OrchestratorEvent, TeamSpec};
use designer_core::{
    Actor, ArtifactId, ArtifactKind, CoreError, EventPayload, EventStore, PayloadRef, Projection,
    StreamId, TabId, WorkspaceId,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant, SystemTime};
use tokio::time::interval;
use tracing::{debug, info, warn};
use uuid::{NoContext, Timestamp, Uuid};

/// Sentinel `TabId` used when a caller posts to a workspace without
/// naming a tab. The orchestrator's team map is keyed by `(workspace,
/// tab)`, so we need *some* `TabId` for the legacy-no-tab path. A nil
/// UUID can't collide with a real tab id (those are UUIDv7) and stays
/// stable across restarts so resume works for the workspace-wide
/// session. Thin wrapper around [`crate::core::default_tab_id_for_workspace`]
/// so dispatch (this module) and lifecycle (close/archive/delete) share
/// one canonical source.
fn default_tab_id() -> TabId {
    crate::core::default_tab_id_for_workspace()
}

/// Resolve an `Option<TabId>` to a concrete `TabId` for the orchestrator
/// dispatch key. `None` → [`default_tab_id`].
fn resolve_tab(tab_id: Option<TabId>) -> TabId {
    tab_id.unwrap_or_else(default_tab_id)
}

/// Produce the manager-readable suffix for a user-facing
/// "couldn't deliver your message to Claude — …" copy. Most variants
/// surface as their `Display` impl (already roughly readable);
/// `ChannelClosed` is the one that previously embedded raw UUIDs
/// ("stdin channel closed for workspace 0192f… / tab 0192f…"), which
/// is engineering jargon for the manager user. Logs still carry the
/// full structured error via `warn!(error = %e, …)` at the call site,
/// so we lose no diagnostics on the operator side.
fn humanize_dispatch_error(err: &OrchestratorError) -> String {
    match err {
        OrchestratorError::ChannelClosed { .. } => {
            "Claude's connection dropped and reconnecting didn't help. Try again in a moment."
                .into()
        }
        other => other.to_string(),
    }
}

/// Author-role we tag user-originated messages with on the wire. Constant
/// here so the coalescer can filter user echoes by exact match instead of
/// stringly-typed comparisons scattered across the file.
pub const USER_AUTHOR_ROLE: &str = "user";

/// Default idle threshold before a coalesced agent message flushes as an
/// `ArtifactCreated`. Matches ADR 0001's "120 ms feels live but doesn't
/// churn" finding. Tests override via `DESIGNER_MESSAGE_COALESCE_MS`.
pub const DEFAULT_COALESCE_WINDOW: Duration = Duration::from_millis(120);

/// Poll cadence for the coalescer's flush check. 30 ms keeps flush latency
/// bounded at `window + 30 ms` without burning a CPU budget.
const COALESCE_TICK: Duration = Duration::from_millis(30);

/// Read the coalesce window from env, falling back to the default. Tests set
/// `DESIGNER_MESSAGE_COALESCE_MS=5` so the round-trip assertion completes in
/// < 100 ms without paying the production "feels live" wait.
pub fn coalesce_window_from_env() -> Duration {
    std::env::var("DESIGNER_MESSAGE_COALESCE_MS")
        .ok()
        .and_then(|v| v.parse::<u64>().ok())
        .map(Duration::from_millis)
        .unwrap_or(DEFAULT_COALESCE_WINDOW)
}

/// Map the frontend's user-facing model identifier (as defined in
/// `ComposeDock.tsx`) to the Claude CLI's `--model` argument. Unknown
/// identifiers return `None` — the orchestrator falls back to its own
/// default model. Kept as a pure function so a unit test can lock the
/// mapping.
pub fn frontend_model_to_claude_cli(id: &str) -> Option<String> {
    match id {
        "opus-4.7" => Some("claude-opus-4-7".to_string()),
        "sonnet-4.6" => Some("claude-sonnet-4-6".to_string()),
        "haiku-4.5" => Some("claude-haiku-4-5".to_string()),
        _ => None,
    }
}

impl AppCore {
    /// Dispatch the user's message to the orchestrator, then — only on
    /// successful dispatch — persist the user's `MessagePosted` event and
    /// the `ArtifactCreated { kind: Message }` artifact. This ordering
    /// rules out the duplicate-artifact pattern where a transient
    /// orchestrator failure leaves a user artifact in the log; the user
    /// retries; a second user artifact lands for the same text. Failed
    /// sends create no events; the frontend restores the draft so the
    /// user can edit and resend without retyping.
    ///
    /// If no chat session has been spawned yet (demo flow / first user
    /// message), we lazy-spawn one as a plain pass-through claude session
    /// and retry the dispatch.
    pub async fn post_message(
        &self,
        workspace_id: WorkspaceId,
        tab_id: Option<TabId>,
        model: Option<String>,
        body: String,
    ) -> Result<ArtifactId, CoreError> {
        if body.trim().is_empty() {
            return Err(CoreError::Invariant(
                "message body must not be empty".into(),
            ));
        }
        // Record the active tab before dispatch so a failed-then-retried
        // send still leaves the agent-reply coalescer pointing at the
        // user's current tab. The map is workspace-scoped; switching
        // tabs and posting again replaces the entry.
        if let Some(t) = tab_id {
            self.set_last_user_tab(workspace_id, t);
        }

        // Phase 23.E: every dispatch picks one (workspace, tab) team. A
        // legacy `None` tab_id resolves to a per-workspace nil sentinel
        // so back-compat callers (boot/replay edge cases without an
        // active tab) still get a real key.
        let dispatch_tab = resolve_tab(tab_id);

        // Map the frontend identifier (e.g. `haiku-4.5`) to the Claude
        // CLI's `--model` argument. Unknown identifiers fall through as
        // `None` — orchestrator default applies.
        let requested_cli_model = model.as_deref().and_then(frontend_model_to_claude_cli);

        // If the user has switched to a different model than the team
        // is currently running on, force a respawn before the message
        // dispatches. Claude takes `--model` once at process start; the
        // only way to change models for an existing session is to
        // restart the subprocess. Cut 1 (2026-05-03): the new
        // subprocess gets a fresh random session id, so model swap
        // resets Claude's *internal* short-term memory — the
        // user-facing transcript persists in `events.db` and renders
        // unchanged. The prior deterministic-session-id scheme tried
        // to preserve in-process memory across the swap and was the
        // source of the "Session ID is already in use" hang.
        //
        // Phase 23.E: model is per-tab, so the comparator is keyed by
        // `(workspace, tab)` — switching model on tab A does not
        // respawn tab B.
        let current_cli_model = self.team_model(workspace_id, dispatch_tab);
        if requested_cli_model.is_some()
            && requested_cli_model.as_deref() != current_cli_model.as_deref()
        {
            info!(
                %workspace_id,
                tab = %dispatch_tab,
                from = ?current_cli_model,
                to = ?requested_cli_model,
                "model change requested; respawning tab team"
            );
            // Fast-kill the live subprocess before respawning so the
            // deterministic per-tab session id is released before the
            // new claude tries to claim it. Without this, the new spawn
            // dies with `Error: Session ID … is already in use` and the
            // user sees a forever-spinning chat. Only the model-change
            // path needs this — the dead-team recovery branch below
            // (`TeamNotFound` / `ChannelClosed`) already runs after the
            // subprocess is gone, so its session id is free. Skipped
            // when there's no prior team (first-post lazy spawn) so
            // tests + boot-path don't pay an unnecessary kill round-
            // trip.
            if current_cli_model.is_some() {
                let _ = self.orchestrator.kill(workspace_id, dispatch_tab).await;
            }
            self.spawn_tab_team(workspace_id, dispatch_tab, requested_cli_model.clone())
                .await
                .map_err(|e| CoreError::Invariant(format!("couldn't reach Claude — {e}")))?;
        }

        // 1. Dispatch to the orchestrator. Lazy-spawn a team if
        //    none exists yet — the demo workspace and any fresh workspace
        //    start without a team, and the user's first message is what
        //    kicks one off.
        //
        //    `ChannelClosed` is treated like `TeamNotFound`: the team
        //    handle is in the orchestrator's map but its writer task has
        //    exited (typically because the `claude` subprocess died —
        //    bundled-`.app` chat-hang regression, see PR debug notes).
        //    The recovery path skips the orchestrator's graceful
        //    `shutdown` (a 60-second wait window for a `Clean up the team`
        //    prompt that a dead lead will never honor) — `spawn_team`'s
        //    `self.teams.lock().insert(...)` overwrites the stale handle,
        //    drops it, and `kill_on_drop(true)` on the old `Child` kills
        //    the old subprocess synchronously. The reader/writer/stderr
        //    tasks exit on their own when their pipes close. The user's
        //    retry "just works" within the message round-trip budget
        //    instead of staring at "submitting…" for a minute.
        match self
            .orchestrator
            .post_message(
                workspace_id,
                dispatch_tab,
                USER_AUTHOR_ROLE.into(),
                body.clone(),
            )
            .await
        {
            Ok(()) => {}
            Err(e @ OrchestratorError::TeamNotFound(_))
            | Err(e @ OrchestratorError::ChannelClosed { .. }) => {
                if matches!(e, OrchestratorError::ChannelClosed { .. }) {
                    info!(
                        %workspace_id,
                        tab = %dispatch_tab,
                        "post_message hit a stale team handle; respawning (insert+drop will kill the old child via kill_on_drop)"
                    );
                }
                self.spawn_tab_team(workspace_id, dispatch_tab, requested_cli_model.clone())
                    .await
                    .map_err(|e| CoreError::Invariant(format!("couldn't reach Claude — {e}")))?;
                if let Err(e) = self
                    .orchestrator
                    .post_message(
                        workspace_id,
                        dispatch_tab,
                        USER_AUTHOR_ROLE.into(),
                        body.clone(),
                    )
                    .await
                {
                    warn!(error = %e, %workspace_id, tab = %dispatch_tab, "post_message after lazy spawn failed");
                    return Err(CoreError::Invariant(format!(
                        "couldn't deliver your message to Claude — {}",
                        humanize_dispatch_error(&e)
                    )));
                }
            }
            Err(e) => {
                warn!(error = %e, %workspace_id, tab = %dispatch_tab, "orchestrator post_message failed");
                return Err(CoreError::Invariant(format!(
                    "couldn't deliver your message to Claude — {}",
                    humanize_dispatch_error(&e)
                )));
            }
        }

        // 2. Append the user's MessagePosted event.
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::MessagePosted {
                    workspace_id,
                    author: Actor::user(),
                    body: body.clone(),
                    tab_id,
                },
            )
            .await?;
        // Phase 24 (ADR 0008) — stash the user-event id so the
        // AgentTurnStarted bridge can stamp `parent_user_event_id`. Set
        // before `projector.apply` runs so a synchronous bridge would
        // see the new value too; the projector itself doesn't read this
        // map, so order doesn't change replay semantics.
        self.set_last_user_event_id(workspace_id, env.id);
        self.projector.apply(&env);

        // 3. Append the ArtifactCreated for the user message.
        let artifact_id = ArtifactId::new();
        let title = first_line_truncate(&body, 60);
        let summary = first_line_truncate(&body, 140);
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::user(),
                EventPayload::ArtifactCreated {
                    artifact_id,
                    workspace_id,
                    artifact_kind: ArtifactKind::Message,
                    title,
                    summary,
                    payload: PayloadRef::inline(body),
                    author_role: Some(USER_AUTHOR_ROLE.into()),
                    tab_id,
                    summary_high: None,
                    classification: None,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(artifact_id)
    }

    /// Lazy-spawn (or respawn) one tab's chat team with the given Claude
    /// CLI model override. Records the model in `team_model_by_tab` so a
    /// later `post_message` for the same `(workspace, tab)` can detect a
    /// model change without re-querying the orchestrator. Reuses the
    /// project's repo root as the cwd so the lead's tools resolve
    /// against the user's code.
    ///
    /// Phase 23.E renamed this from `spawn_workspace_team` to surface the
    /// per-tab dispatch contract — every team is owned by one
    /// `(workspace, tab)` pair, never the workspace as a whole. A future
    /// multi-agent-dispatch path can introduce a separate spawn helper
    /// without re-litigating the per-tab default.
    pub(crate) async fn spawn_tab_team(
        &self,
        workspace_id: WorkspaceId,
        tab_id: TabId,
        model: Option<String>,
    ) -> Result<(), OrchestratorError> {
        let cwd = self
            .projector
            .workspace(workspace_id)
            .and_then(|ws| self.projector.project(ws.project_id))
            .map(|p| p.root_path);
        // Default chat is plain pass-through claude. `lead_role: "assistant"`
        // is the wire role used to attribute reply artifacts (`Actor::Agent {
        // role: "assistant" }`); the frontend humanize map renders both the
        // current `assistant` and historical `team-lead` values, so existing
        // event-store data still reads as "Designer" in the UI after this
        // switch. Multi-agent teams are out of scope for v1 and will land
        // behind a future opt-in `TeamSpec` variant.
        // Phase 24 (ADR 0008) — read `show_chat_v2` once at spawn so
        // the translator's emission family is fixed for the lifetime
        // of this subprocess. Flipping the flag mid-session would
        // cross emission paths in the same event log; the simpler rule
        // is "the flag at spawn time wins until the next respawn."
        // The respawn paths (model swap, dead-team recovery) re-read
        // the flag so a flip surfaces after the next user message
        // forces a respawn.
        let phase24 = crate::settings::Settings::load(&self.config.data_dir)
            .feature_flags
            .show_chat_v2;
        let spec = TeamSpec {
            workspace_id,
            tab_id,
            team_name: format!("workspace-{workspace_id}-tab-{tab_id}"),
            lead_role: "assistant".into(),
            teammates: vec![],
            env: Default::default(),
            cwd,
            model: model.clone(),
            phase24,
        };
        match self.orchestrator.spawn_team(spec).await {
            Ok(()) => {
                self.set_team_model(workspace_id, tab_id, model);
                Ok(())
            }
            Err(e) => {
                warn!(error = %e, %workspace_id, %tab_id, "spawn_team failed");
                Err(e)
            }
        }
    }

    /// Append an agent-produced artifact (diagram or report) directly. The
    /// translator extension that wires real Claude tool-use calls into this
    /// path lands per-tool as we observe the tool-use shapes; until then,
    /// MockOrchestrator's keyword-driven simulator (see `mock.rs::post_message`)
    /// emits `OrchestratorEvent::ArtifactProduced` and the coalescer routes
    /// those into here. Caller chooses the kind; only `Diagram` and `Report`
    /// are accepted in 13.D — other kinds belong to E/F/G.
    ///
    /// `artifact_id` is supplied by the emitter so a later
    /// `OrchestratorEvent::ArtifactUpdated` can target the same artifact
    /// (Phase 13.H+1 tool_use → tool_result correlation in
    /// `ClaudeStreamTranslator`). Emitters without a correlation need
    /// generate a fresh `ArtifactId::new()` per call.
    /// Phase 23.F — abort the current turn for one tab. Wraps
    /// `Orchestrator::interrupt`. Unlike `post_message` we don't lazy-spawn
    /// or retry on `TeamNotFound` / `ChannelClosed`: there's no useful
    /// recovery for "interrupt a turn that isn't running" — the user's
    /// intent is satisfied because the activity row is already idle. We
    /// translate both into `Ok(())` so the frontend doesn't surface noisy
    /// errors when the user clicks Stop just as the turn ends.
    pub async fn interrupt_turn(
        &self,
        workspace_id: WorkspaceId,
        tab_id: Option<TabId>,
    ) -> Result<(), CoreError> {
        let dispatch_tab = resolve_tab(tab_id);
        match self
            .orchestrator
            .interrupt(workspace_id, dispatch_tab)
            .await
        {
            Ok(()) => Ok(()),
            Err(OrchestratorError::TeamNotFound(_))
            | Err(OrchestratorError::ChannelClosed { .. }) => {
                debug!(
                    %workspace_id,
                    tab = %dispatch_tab,
                    "interrupt_turn: no live team or stale handle; treating as no-op"
                );
                Ok(())
            }
            Err(e) => {
                warn!(error = %e, %workspace_id, tab = %dispatch_tab, "orchestrator interrupt failed");
                Err(CoreError::Invariant(format!(
                    "couldn't interrupt the turn — {}",
                    humanize_dispatch_error(&e)
                )))
            }
        }
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn emit_agent_artifact(
        &self,
        workspace_id: WorkspaceId,
        artifact_id: ArtifactId,
        kind: ArtifactKind,
        title: String,
        summary: String,
        body: String,
        author_role: Option<String>,
    ) -> Result<ArtifactId, CoreError> {
        if !matches!(kind, ArtifactKind::Diagram | ArtifactKind::Report) {
            return Err(CoreError::Invariant(format!(
                "13.D may only emit diagram/report artifacts, not {kind:?}"
            )));
        }
        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::agent(
                    "workspace-lead",
                    author_role.as_deref().unwrap_or("assistant"),
                ),
                EventPayload::ArtifactCreated {
                    artifact_id,
                    workspace_id,
                    artifact_kind: kind,
                    title,
                    summary,
                    payload: PayloadRef::inline(body),
                    author_role,
                    // Diagram/report kinds are workspace-wide — no tab scope.
                    tab_id: None,
                    summary_high: None,
                    classification: None,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(artifact_id)
    }

    /// Apply an in-place update from the translator (tool_use → tool_result
    /// correlation). The artifact must already exist; if its current
    /// version can't be resolved (e.g. the producing event was dropped by
    /// the coalescer or never materialised) the update is logged and
    /// dropped.
    ///
    /// The appended `ArtifactUpdated` event reuses the producing
    /// artifact's `author_role` for the envelope `Actor` so any future
    /// per-author rail filter, mention surface, or audit query sees a
    /// consistent provenance chain across produce → update. Hard-coding
    /// the lead role here would silently misattribute updates whenever a
    /// non-default author (e.g. `auditor`, `recap`) was the original author.
    pub async fn update_agent_artifact_summary(
        &self,
        artifact_id: ArtifactId,
        summary: String,
    ) -> Result<(), CoreError> {
        let Some(artifact) = self.projector.artifact(artifact_id) else {
            debug!(%artifact_id, "update_agent_artifact_summary: artifact not found");
            return Ok(());
        };
        let payload = artifact.payload.clone();
        let parent_version = artifact.version;
        let stream = StreamId::Workspace(artifact.workspace_id);
        let actor = Actor::agent(
            "workspace-lead",
            artifact.author_role.as_deref().unwrap_or("assistant"),
        );
        let env = self
            .store
            .append(
                stream,
                None,
                actor,
                EventPayload::ArtifactUpdated {
                    artifact_id,
                    summary,
                    payload,
                    parent_version,
                    summary_high: None,
                    classification: None,
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Phase 24 (ADR 0008) — persist an `AgentTurn*` event to the
    /// workspace stream. Called by [`spawn_message_coalescer`]'s recv
    /// loop on every `OrchestratorEvent::AgentTurn*` broadcast emitted
    /// by the Phase 24 stream translator. The bridge stamps
    /// `parent_user_event_id` from `last_user_event_id(workspace_id)`
    /// so the renderer can thread agent turns back to the user message
    /// that triggered them.
    ///
    /// Author for every `AgentTurn*` envelope is `Actor::Agent { team:
    /// "workspace-lead", role: "assistant" }` — same provenance the
    /// legacy `MessagePosted{Agent}` carried, so cross-author audit
    /// queries don't see a discontinuity at the cut-over.
    /// Phase 24 (ADR 0008) — read every chat-domain event for a
    /// workspace from the persisted SQLite store. Used by the
    /// frontend's boot replay (`bootData → chatThreadStore`) so the
    /// new chat surface paints past `AgentTurn*` events on app start
    /// without waiting for the next live event. Returns events in
    /// (stream, sequence) order; the caller folds them through the
    /// chatThread reducer.
    ///
    /// "Chat-domain" here is `MessagePosted` (any author) plus the
    /// six `AgentTurn*` variants. The reducer's user-message branch
    /// only fires for `Actor::User`, so passing the union keeps the
    /// API narrow without filtering on the frontend.
    pub async fn list_workspace_chat_events(
        &self,
        workspace_id: WorkspaceId,
    ) -> Result<Vec<designer_core::EventEnvelope>, CoreError> {
        use designer_core::EventStore as _;
        let events = self
            .store
            .read_stream(
                StreamId::Workspace(workspace_id),
                designer_core::StreamOptions::default(),
            )
            .await?;
        Ok(events
            .into_iter()
            .filter(|env| is_chat_domain(&env.payload))
            .collect())
    }

    pub async fn persist_agent_turn_event(
        &self,
        payload: EventPayload,
        workspace_id: WorkspaceId,
    ) -> Result<(), CoreError> {
        let actor = Actor::agent("workspace-lead", "assistant");
        let env = self
            .store
            .append(StreamId::Workspace(workspace_id), None, actor, payload)
            .await?;
        self.projector.apply(&env);
        Ok(())
    }
}

/// Per (workspace, author_role) pending coalesced text + last-update marker.
///
/// `tab_id` is captured **once** when the entry is first populated (i.e.
/// before its `body` accumulates any tokens). The flush path uses this
/// stable value rather than re-reading `AppCore::last_user_tab` at flush
/// time, which would race with the user posting in a different tab while
/// the agent's reply is still streaming. Concretely: user posts in A,
/// agent starts streaming reply 1, user switches and posts in B before
/// reply 1 idles for the coalesce window, flush reads `last_user_tab` =
/// B and misattributes reply 1 to B. Capturing at first-recv pins the
/// reply to A — the tab where the conversation started.
///
/// `first_seen_at` is captured the same way: a wall-clock `Timestamp`
/// taken on the first chunk of the burst. The flush path stamps the
/// outgoing `ArtifactId`'s UUIDv7 with this value via
/// [`first_seen_artifact_id`] so the agent reply sorts by *when it
/// started streaming*, not when the idle window expired. Without this,
/// a user message posted between the last agent token and the flush
/// lands chronologically *before* the agent text (id from
/// `Uuid::now_v7()` at flush time), and tool-use artifacts that ran
/// during the turn end up *after* it — chat reads jumbled.
#[derive(Debug, Default)]
struct PendingMessage {
    body: String,
    last_update: Option<Instant>,
    tab_id: Option<TabId>,
    first_seen_at: Option<Timestamp>,
}

/// Build an `ArtifactId` whose UUIDv7 timestamp is the captured
/// first-chunk wall-clock time, not the flush time. Lower bits remain
/// random per `Uuid::new_v7`'s contract, so concurrent flushes at the
/// same millisecond stay unique.
fn first_seen_artifact_id(first_seen: Timestamp) -> ArtifactId {
    ArtifactId::from_uuid(Uuid::new_v7(first_seen))
}

/// Phase 24 — discriminate the chat-domain event subset for boot
/// replay. The frontend reducer only consumes `MessagePosted` +
/// `AgentTurn*`; everything else (artifacts, approvals, friction,
/// findings, proposals, etc.) flows through other surfaces and would
/// only inflate the boot fetch.
fn is_chat_domain(payload: &EventPayload) -> bool {
    matches!(
        payload,
        EventPayload::MessagePosted { .. }
            | EventPayload::AgentTurnStarted { .. }
            | EventPayload::AgentContentBlockStarted { .. }
            | EventPayload::AgentContentBlockDelta { .. }
            | EventPayload::AgentContentBlockEnded { .. }
            | EventPayload::AgentToolResult { .. }
            | EventPayload::AgentTurnEnded { .. }
    )
}

/// Capture wall-clock now as a `uuid::Timestamp` suitable for
/// `Uuid::new_v7`. Falls back to the Unix epoch on the (vanishingly
/// unlikely) pre-epoch system clock — preserving "this artifact predates
/// any real wall-clock event" rather than panicking.
fn now_uuid_timestamp() -> Timestamp {
    let now = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default();
    Timestamp::from_unix(NoContext, now.as_secs(), now.subsec_nanos())
}

type CoalescerKey = (WorkspaceId, String);

/// Spawn the message-coalescer task. Subscribes to the orchestrator's event
/// broadcast and turns bursts of `MessagePosted` events into one
/// `ArtifactCreated { kind: Message }` per (workspace, author_role) once the
/// burst has been idle for `window`. User-authored events (`author_role ==
/// "user"`) are skipped — those are persisted by `AppCore::post_message`
/// directly so the user sees their text immediately, and the orchestrator's
/// echo is a no-op.
///
/// Free function rather than a method on `AppCore` so we don't have to add
/// boot wiring to `core.rs`'s `impl AppCore { … }` block (per
/// `CLAUDE.md` §"Parallel track conventions").
///
/// **Lifecycle.** Both spawned tasks hold `Weak<AppCore>` so they don't
/// keep the core alive past the caller's last `Arc`. The recv task exits
/// when the broadcast channel closes (orchestrator dropped) or the weak
/// upgrade fails; the flush task exits when the weak upgrade fails.
/// Tests can repeatedly call `spawn_message_coalescer` without leaking
/// tasks across `boot_test_core` invocations.
pub fn spawn_message_coalescer(core: Arc<AppCore>, window: Duration) {
    let mut rx = core.orchestrator.subscribe();
    let pending: Arc<Mutex<HashMap<CoalescerKey, PendingMessage>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let weak_for_recv: Weak<AppCore> = Arc::downgrade(&core);
    let weak_for_tick: Weak<AppCore> = Arc::downgrade(&core);
    drop(core);

    let pending_for_recv = pending.clone();
    let pending_for_tick = pending;

    // Receive task: accumulates bodies into the per-key pending state. We
    // never flush from this side — the tick task owns flush — to avoid
    // racing two writers against the same key.
    tauri::async_runtime::spawn(async move {
        loop {
            match rx.recv().await {
                Ok(ev) => match ev {
                    OrchestratorEvent::MessagePosted {
                        workspace_id,
                        author_role,
                        body,
                    } => {
                        if author_role == USER_AUTHOR_ROLE {
                            // User echoes never become artifacts via the
                            // coalescer — they're already persisted by
                            // post_message().
                            continue;
                        }
                        // Capture the user's active tab once per pending
                        // burst, on the very first token. Re-reading at
                        // flush time would race with a fast tab-switch
                        // mid-stream and misattribute the reply (see
                        // PendingMessage doc-comment).
                        let captured_tab = if let Some(core) = weak_for_recv.upgrade() {
                            core.last_user_tab(workspace_id)
                        } else {
                            None
                        };
                        let mut p = pending_for_recv.lock();
                        let entry = p.entry((workspace_id, author_role.clone())).or_default();
                        if entry.body.is_empty() {
                            entry.tab_id = captured_tab;
                            // SystemTime captured alongside Instant —
                            // they aren't derivable from each other and
                            // we need the wall-clock half for the
                            // UUIDv7 stamp.
                            entry.first_seen_at = Some(now_uuid_timestamp());
                        }
                        entry.body.push_str(&body);
                        entry.last_update = Some(Instant::now());
                    }
                    OrchestratorEvent::ArtifactProduced {
                        workspace_id,
                        artifact_id,
                        artifact_kind,
                        title,
                        summary,
                        body,
                        author_role,
                    } => {
                        // Tool-call artifacts bypass the coalescer — each
                        // tool call is one logical artifact. We persist
                        // inline (not via `tokio::spawn`) so concurrent
                        // SQLite writers don't race the AppCore::post_message
                        // path. Tool-call burst rate is low enough that
                        // briefly blocking the recv loop here is fine; the
                        // broadcast channel buffers 256 events.
                        let Some(core) = weak_for_recv.upgrade() else {
                            break;
                        };
                        match core
                            .emit_agent_artifact(
                                workspace_id,
                                artifact_id,
                                artifact_kind,
                                title,
                                summary,
                                body,
                                author_role,
                            )
                            .await
                        {
                            Ok(id) => debug!(%id, "emit_agent_artifact ok"),
                            Err(e) => warn!(error = %e, "emit_agent_artifact failed"),
                        }
                    }
                    OrchestratorEvent::ArtifactUpdated {
                        workspace_id: _,
                        artifact_id,
                        summary,
                    } => {
                        let Some(core) = weak_for_recv.upgrade() else {
                            break;
                        };
                        if let Err(e) = core
                            .update_agent_artifact_summary(artifact_id, summary)
                            .await
                        {
                            warn!(error = %e, "update_agent_artifact_summary failed");
                        }
                    }
                    // Phase 24 (ADR 0008) — bridge new chat-domain
                    // broadcasts into the persisted event log. The
                    // translator only emits these in phase24 mode
                    // (gated on `show_chat_v2`); legacy mode skips
                    // these arms entirely. `parent_user_event_id` is
                    // pulled from `last_user_event_id` — the user
                    // message that triggered the turn — captured in
                    // `post_message`. The `EventId::nil` fallback only
                    // fires for an agent turn that arrives before any
                    // user post on the workspace, which shouldn't
                    // happen in practice.
                    OrchestratorEvent::AgentTurnStarted {
                        workspace_id,
                        tab_id,
                        turn_id,
                        model,
                        session_id,
                    } => {
                        let Some(core) = weak_for_recv.upgrade() else {
                            break;
                        };
                        let parent_user_event_id = core
                            .last_user_event_id(workspace_id)
                            .unwrap_or_else(designer_core::EventId::default);
                        let payload = EventPayload::AgentTurnStarted {
                            workspace_id,
                            tab_id,
                            turn_id,
                            model,
                            parent_user_event_id,
                            session_id,
                        };
                        if let Err(e) = core.persist_agent_turn_event(payload, workspace_id).await {
                            warn!(error = %e, "persist AgentTurnStarted failed");
                        }
                    }
                    OrchestratorEvent::AgentContentBlockStarted {
                        workspace_id,
                        tab_id,
                        turn_id,
                        block_index,
                        block_kind,
                    } => {
                        let Some(core) = weak_for_recv.upgrade() else {
                            break;
                        };
                        let payload = EventPayload::AgentContentBlockStarted {
                            workspace_id,
                            tab_id,
                            turn_id,
                            block_index,
                            block_kind,
                        };
                        if let Err(e) = core.persist_agent_turn_event(payload, workspace_id).await {
                            warn!(error = %e, "persist AgentContentBlockStarted failed");
                        }
                    }
                    OrchestratorEvent::AgentContentBlockDelta {
                        workspace_id,
                        tab_id,
                        turn_id,
                        block_index,
                        delta,
                    } => {
                        let Some(core) = weak_for_recv.upgrade() else {
                            break;
                        };
                        let payload = EventPayload::AgentContentBlockDelta {
                            workspace_id,
                            tab_id,
                            turn_id,
                            block_index,
                            delta,
                        };
                        if let Err(e) = core.persist_agent_turn_event(payload, workspace_id).await {
                            warn!(error = %e, "persist AgentContentBlockDelta failed");
                        }
                    }
                    OrchestratorEvent::AgentContentBlockEnded {
                        workspace_id,
                        tab_id,
                        turn_id,
                        block_index,
                    } => {
                        let Some(core) = weak_for_recv.upgrade() else {
                            break;
                        };
                        let payload = EventPayload::AgentContentBlockEnded {
                            workspace_id,
                            tab_id,
                            turn_id,
                            block_index,
                        };
                        if let Err(e) = core.persist_agent_turn_event(payload, workspace_id).await {
                            warn!(error = %e, "persist AgentContentBlockEnded failed");
                        }
                    }
                    OrchestratorEvent::AgentToolResult {
                        workspace_id,
                        tab_id,
                        turn_id,
                        tool_use_id,
                        content,
                        is_error,
                    } => {
                        let Some(core) = weak_for_recv.upgrade() else {
                            break;
                        };
                        let payload = EventPayload::AgentToolResult {
                            workspace_id,
                            tab_id,
                            turn_id,
                            tool_use_id,
                            content,
                            is_error,
                        };
                        if let Err(e) = core.persist_agent_turn_event(payload, workspace_id).await {
                            warn!(error = %e, "persist AgentToolResult failed");
                        }
                    }
                    OrchestratorEvent::AgentTurnEnded {
                        workspace_id,
                        tab_id,
                        turn_id,
                        stop_reason,
                        usage,
                    } => {
                        let Some(core) = weak_for_recv.upgrade() else {
                            break;
                        };
                        let payload = EventPayload::AgentTurnEnded {
                            workspace_id,
                            tab_id,
                            turn_id,
                            stop_reason,
                            usage,
                        };
                        if let Err(e) = core.persist_agent_turn_event(payload, workspace_id).await {
                            warn!(error = %e, "persist AgentTurnEnded failed");
                        }
                    }
                    _ => {}
                },
                Err(tokio::sync::broadcast::error::RecvError::Lagged(n)) => {
                    warn!(skipped = n, "coalescer recv lagged");
                    continue;
                }
                Err(tokio::sync::broadcast::error::RecvError::Closed) => {
                    debug!("coalescer recv channel closed");
                    break;
                }
            }
        }
    });

    // Flush task: walks pending state every COALESCE_TICK, flushing entries
    // that have been idle for >= window.
    tauri::async_runtime::spawn(async move {
        let mut ticker = interval(COALESCE_TICK);
        loop {
            ticker.tick().await;
            let Some(core) = weak_for_tick.upgrade() else {
                debug!("coalescer flush task: AppCore dropped, exiting");
                break;
            };
            let now = Instant::now();
            let mut to_flush: Vec<(CoalescerKey, String, Option<TabId>, Option<Timestamp>)> =
                Vec::new();
            {
                let mut p = pending_for_tick.lock();
                p.retain(|key, entry| {
                    let due = match entry.last_update {
                        Some(t) => now.duration_since(t) >= window,
                        None => false,
                    };
                    if due {
                        to_flush.push((
                            key.clone(),
                            std::mem::take(&mut entry.body),
                            entry.tab_id,
                            entry.first_seen_at.take(),
                        ));
                        false
                    } else {
                        true
                    }
                });
            }
            for ((workspace_id, author_role), body, captured_tab, first_seen) in to_flush {
                if body.trim().is_empty() {
                    continue;
                }
                let title = first_line_truncate(&body, 60);
                let summary = first_line_truncate(&body, 140);
                // Stamp the artifact's UUIDv7 with the moment the burst
                // started streaming. Pre-23.A flushes used
                // `ArtifactId::new()` (now_v7 at flush time), which let
                // mid-burst user posts and tool-use artifacts sort
                // before the agent text. `first_seen` will be `None`
                // only for entries inserted before this commit's
                // codepath ran, which is impossible in practice — fall
                // back to `now_v7` to preserve liveness.
                let artifact_id = match first_seen {
                    Some(ts) => first_seen_artifact_id(ts),
                    None => ArtifactId::new(),
                };
                // Per-tab thread isolation: use the tab captured when this
                // burst started streaming, not whatever tab the user is in
                // right now. Falling back to `last_user_tab` covers the
                // edge case where the entry was created before the user
                // ever posted (e.g. an unsolicited agent message at boot).
                // The projector applies first-tab legacy attribution if
                // both are still `None`.
                let reply_tab = captured_tab.or_else(|| core.last_user_tab(workspace_id));
                let res = core
                    .store
                    .append(
                        StreamId::Workspace(workspace_id),
                        None,
                        Actor::agent("workspace-lead", &author_role),
                        EventPayload::ArtifactCreated {
                            artifact_id,
                            workspace_id,
                            artifact_kind: ArtifactKind::Message,
                            title,
                            summary,
                            payload: PayloadRef::inline(body),
                            author_role: Some(author_role),
                            tab_id: reply_tab,
                            summary_high: None,
                            classification: None,
                        },
                    )
                    .await;
                match res {
                    Ok(env) => core.projector.apply(&env),
                    Err(e) => warn!(error = %e, "coalescer flush append failed"),
                }
            }
        }
    });
}

/// Truncate to `max_chars` graphemes-as-chars and prefer the first line.
/// Used for both `title` (short) and `summary` (longer) so a multi-line
/// paste doesn't leak its body into the rail label.
fn first_line_truncate(s: &str, max_chars: usize) -> String {
    let first = s.lines().next().unwrap_or("").trim();
    let target = if first.is_empty() { s.trim() } else { first };
    let mut out: String = target.chars().take(max_chars).collect();
    if target.chars().count() > max_chars {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::{AppConfig, AppCoreBoot};
    use designer_safety::CostCap;
    use tempfile::tempdir;

    #[test]
    fn truncate_prefers_first_line() {
        let body = "Hello team\n\nLong follow-up paragraph that we don't want in the title.";
        assert_eq!(first_line_truncate(body, 60), "Hello team");
    }

    #[test]
    fn truncate_appends_ellipsis_when_capped() {
        let body = "x".repeat(80);
        let out = first_line_truncate(&body, 60);
        assert!(out.ends_with('…'));
        assert_eq!(out.chars().count(), 61);
    }

    #[test]
    fn truncate_handles_empty_first_line() {
        let body = "\n\nactual content here";
        assert_eq!(first_line_truncate(body, 60), "actual content here");
    }

    async fn boot_test_core() -> Arc<AppCore> {
        std::env::set_var("DESIGNER_MESSAGE_COALESCE_MS", "5");
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);
        AppCore::boot(config).await.unwrap()
    }

    /// Coalescer must skip events whose `author_role == "user"` so the
    /// user's own echo (the orchestrator broadcasts the prompt back) does
    /// not turn into a duplicate `Message` artifact next to the one
    /// `post_message` already wrote.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn coalescer_drops_user_echoes() {
        let core = boot_test_core().await;
        spawn_message_coalescer(core.clone(), Duration::from_millis(5));
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        // Spawn a team so post_message succeeds (skip the lazy-spawn
        // path, which would also work but couples this test to that
        // detail).
        core.orchestrator
            .spawn_team(designer_claude::TeamSpec {
                workspace_id: ws.id,
                tab_id: default_tab_id(),
                team_name: "t".into(),
                lead_role: "team-lead".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
                phase24: false,
            })
            .await
            .unwrap();
        // Direct synthetic broadcast of a USER-author MessagePosted —
        // this is what the orchestrator emits when echoing the prompt
        // back. The coalescer must drop it.
        // We can't access the broadcast Sender directly, so instead we
        // call post_message which causes the mock to broadcast both a
        // user-author and a team-lead-author event. We then verify that
        // exactly one extra (non-user) message artifact lands —
        // confirming the user echo was dropped.
        core.post_message(ws.id, None, None, "hello team".into())
            .await
            .unwrap();
        // Wait past the coalescer window. Generous 3 s headroom for
        // scheduler dilation under parallel test load.
        let deadline = Instant::now() + Duration::from_millis(3000);
        loop {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let arts = core.list_artifacts(ws.id).await;
            let agent_messages = arts
                .iter()
                .filter(|a| {
                    a.kind == ArtifactKind::Message
                        && a.author_role.as_deref() != Some(USER_AUTHOR_ROLE)
                })
                .count();
            if agent_messages == 1 {
                return; // exactly one agent message — user echo was dropped
            }
            assert!(
                Instant::now() < deadline,
                "expected exactly 1 agent message, currently see: {:?}",
                arts.iter()
                    .map(|a| (a.kind, a.author_role.clone()))
                    .collect::<Vec<_>>()
            );
        }
    }

    /// Two distinct (workspace, author_role) keys must coalesce
    /// independently — text from one must not bleed into the other's
    /// artifact body.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn coalescer_separates_keys() {
        let core = boot_test_core().await;
        spawn_message_coalescer(core.clone(), Duration::from_millis(5));
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws_a = core
            .create_workspace(project.id, "a".into(), "main".into())
            .await
            .unwrap();
        let ws_b = core
            .create_workspace(project.id, "b".into(), "main".into())
            .await
            .unwrap();
        core.post_message(ws_a.id, None, None, "alpha".into())
            .await
            .unwrap();
        core.post_message(ws_b.id, None, None, "beta".into())
            .await
            .unwrap();
        let deadline = Instant::now() + Duration::from_millis(3000);
        loop {
            tokio::time::sleep(Duration::from_millis(20)).await;
            let arts_a = core.list_artifacts(ws_a.id).await;
            let arts_b = core.list_artifacts(ws_b.id).await;
            let agent_a = arts_a.iter().find(|a| {
                a.kind == ArtifactKind::Message
                    && a.author_role.as_deref() != Some(USER_AUTHOR_ROLE)
            });
            let agent_b = arts_b.iter().find(|a| {
                a.kind == ArtifactKind::Message
                    && a.author_role.as_deref() != Some(USER_AUTHOR_ROLE)
            });
            if let (Some(a), Some(b)) = (agent_a, agent_b) {
                assert!(
                    a.summary.contains("alpha"),
                    "ws_a agent reply did not include its prompt: {}",
                    a.summary
                );
                assert!(
                    b.summary.contains("beta"),
                    "ws_b agent reply did not include its prompt: {}",
                    b.summary
                );
                assert!(
                    !a.summary.contains("beta"),
                    "ws_a leaked ws_b's body: {}",
                    a.summary
                );
                assert!(
                    !b.summary.contains("alpha"),
                    "ws_b leaked ws_a's body: {}",
                    b.summary
                );
                return;
            }
            assert!(
                Instant::now() < deadline,
                "agent replies did not land for both workspaces"
            );
        }
    }

    /// Per-tab thread isolation, cross-tab race regression. The agent
    /// reply must attribute to the tab the user typed in **when the
    /// reply started streaming**, not whatever tab is active when the
    /// coalescer flushes. Scenario: user posts in tab A; before the
    /// coalescer's idle window elapses we flip `last_user_tab` to tab B
    /// (simulating a fast tab-switch + post). Pre-fix, the flush would
    /// read `last_user_tab` at flush time → B, misattributing reply 1.
    /// Post-fix, the pending entry captured A at first-recv and the
    /// reply lands in A regardless.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn coalescer_attributes_reply_to_tab_at_first_recv_not_at_flush() {
        // 200 ms coalesce window gives the test thread room to flip
        // `last_user_tab` mid-stream before the flush fires.
        std::env::set_var("DESIGNER_MESSAGE_COALESCE_MS", "200");
        let core = boot_test_core().await;
        spawn_message_coalescer(core.clone(), Duration::from_millis(200));
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let tab_a = core
            .open_tab(ws.id, "Tab A".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();
        let tab_b = core
            .open_tab(ws.id, "Tab B".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();
        core.orchestrator
            .spawn_team(designer_claude::TeamSpec {
                workspace_id: ws.id,
                tab_id: default_tab_id(),
                team_name: "t".into(),
                lead_role: "team-lead".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
                phase24: false,
            })
            .await
            .unwrap();
        // Post in tab A — the mock orchestrator broadcasts a team-lead
        // reply, the coalescer's pending entry is created with
        // tab_id=tab_a.id captured. We do NOT wait for flush — instead
        // we flip last_user_tab to B before the 200ms idle window
        // elapses, simulating "user switches tabs while agent is
        // streaming a reply".
        core.post_message(ws.id, Some(tab_a.id), None, "hello from A".into())
            .await
            .unwrap();
        core.set_last_user_tab(ws.id, tab_b.id);

        // Wait past the coalescer window for the reply to land.
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let in_a = core.list_artifacts_in_tab(ws.id, tab_a.id).await;
            let agent_in_a = in_a
                .iter()
                .filter(|a| {
                    a.kind == ArtifactKind::Message
                        && a.author_role.as_deref() != Some(USER_AUTHOR_ROLE)
                })
                .count();
            if agent_in_a >= 1 {
                let in_b = core.list_artifacts_in_tab(ws.id, tab_b.id).await;
                let agent_in_b = in_b
                    .iter()
                    .filter(|a| {
                        a.kind == ArtifactKind::Message
                            && a.author_role.as_deref() != Some(USER_AUTHOR_ROLE)
                    })
                    .count();
                assert_eq!(
                    agent_in_b, 0,
                    "agent reply leaked into tab B (cross-tab race regression)"
                );
                return;
            }
            assert!(
                Instant::now() < deadline,
                "agent reply never landed in tab A within deadline"
            );
        }
    }

    /// Extract the embedded Unix-millis timestamp from a UUIDv7. The
    /// upper 48 bits of a v7 are the millisecond timestamp; everything
    /// below is random / variant. Used by Phase 23.A acceptance tests.
    fn uuid_v7_unix_millis(u: &Uuid) -> u64 {
        let bytes = u.as_bytes();
        let mut ms = [0u8; 8];
        ms[2..8].copy_from_slice(&bytes[0..6]);
        u64::from_be_bytes(ms)
    }

    fn now_unix_millis() -> u64 {
        SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64
    }

    /// T-23A — Helper round-trips: a `Timestamp` built from a captured
    /// `SystemTime` survives `Uuid::new_v7` and reads back the same
    /// millisecond value.
    #[test]
    fn first_seen_artifact_id_preserves_millis() {
        let captured_ms = now_unix_millis();
        let secs = captured_ms / 1000;
        let nanos = ((captured_ms % 1000) * 1_000_000) as u32;
        let ts = Timestamp::from_unix(NoContext, secs, nanos);
        let id = first_seen_artifact_id(ts);
        let read = uuid_v7_unix_millis(id.as_uuid());
        assert_eq!(read, captured_ms);
    }

    /// T-23A-2 / T-23A-1 — flush stamps the artifact id with the
    /// first-chunk wall-clock time, not the flush time. We force a
    /// healthy gap between the burst start and the flush by using a
    /// 200 ms coalesce window and asserting that the artifact's UUIDv7
    /// timestamp is much closer to the start than to the flush. This
    /// implicitly proves that the first chunk's `first_seen_at` was
    /// captured (T-23A-1) and used at flush (T-23A-2).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn coalescer_flushed_artifact_uses_first_chunk_timestamp() {
        std::env::set_var("DESIGNER_MESSAGE_COALESCE_MS", "200");
        let core = boot_test_core().await;
        spawn_message_coalescer(core.clone(), Duration::from_millis(200));
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        core.orchestrator
            .spawn_team(designer_claude::TeamSpec {
                workspace_id: ws.id,
                tab_id: default_tab_id(),
                team_name: "t".into(),
                lead_role: "team-lead".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
                phase24: false,
            })
            .await
            .unwrap();

        let burst_start_ms = now_unix_millis();
        core.post_message(ws.id, None, None, "first chunk".into())
            .await
            .unwrap();

        // Wait for the flush: 200ms window + 30ms tick + scheduler slack.
        let deadline = Instant::now() + Duration::from_secs(3);
        let agent_id = loop {
            tokio::time::sleep(Duration::from_millis(50)).await;
            let arts = core.list_artifacts(ws.id).await;
            if let Some(a) = arts.iter().find(|a| {
                a.kind == ArtifactKind::Message
                    && a.author_role.as_deref() != Some(USER_AUTHOR_ROLE)
            }) {
                break a.id;
            }
            assert!(
                Instant::now() < deadline,
                "agent artifact never flushed within deadline"
            );
        };

        let stamped_ms = uuid_v7_unix_millis(agent_id.as_uuid());
        let flush_ms = now_unix_millis();

        // The stamp should be near burst_start_ms, not near flush_ms.
        // We allow the stamp to be at or after burst_start_ms (the recv
        // task captures it after the broadcast hop) and well before
        // flush_ms — at least one full coalesce window earlier. The
        // ±10ms backward tolerance covers SystemTime granularity drift
        // and scheduler jitter under CI load (review: tight 2ms bound
        // would flake under contention; widening is purely safety).
        assert!(
            stamped_ms + 10 >= burst_start_ms,
            "stamped_ms ({stamped_ms}) precedes burst_start_ms ({burst_start_ms}) by more than 10ms tolerance"
        );
        // Flush happens ~window after the chunk lands. If the bug were
        // present (id from now_v7 at flush time), stamped_ms would be
        // within a few ms of flush_ms; assert it's at least 100 ms
        // earlier — half the window — to leave headroom under load.
        assert!(
            flush_ms.saturating_sub(stamped_ms) >= 100,
            "stamped_ms ({stamped_ms}) is too close to flush_ms ({flush_ms}); expected stamp to predate flush by >=100ms"
        );
    }

    /// T-23A-3 — multi-burst isolation. Two bursts on the same
    /// (workspace, author_role) key separated by a gap larger than the
    /// coalesce window must produce two artifacts whose stamped ids
    /// reflect each burst's start time. If `first_seen_at` weren't
    /// reset on flush, burst 2 would inherit burst 1's timestamp.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn coalescer_first_seen_resets_between_bursts() {
        std::env::set_var("DESIGNER_MESSAGE_COALESCE_MS", "60");
        let core = boot_test_core().await;
        spawn_message_coalescer(core.clone(), Duration::from_millis(60));
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        core.orchestrator
            .spawn_team(designer_claude::TeamSpec {
                workspace_id: ws.id,
                tab_id: default_tab_id(),
                team_name: "t".into(),
                lead_role: "team-lead".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
                phase24: false,
            })
            .await
            .unwrap();

        let burst1_start = now_unix_millis();
        core.post_message(ws.id, None, None, "burst one".into())
            .await
            .unwrap();
        // Wait long enough for burst 1 to flush AND clear its pending
        // entry (window + tick + scheduler slack).
        tokio::time::sleep(Duration::from_millis(400)).await;

        let burst2_start = now_unix_millis();
        core.post_message(ws.id, None, None, "burst two".into())
            .await
            .unwrap();

        // Wait for both flushes to complete.
        let deadline = Instant::now() + Duration::from_secs(3);
        let (id1, id2) = loop {
            tokio::time::sleep(Duration::from_millis(40)).await;
            let arts = core.list_artifacts(ws.id).await;
            let mut agent: Vec<_> = arts
                .into_iter()
                .filter(|a| {
                    a.kind == ArtifactKind::Message
                        && a.author_role.as_deref() != Some(USER_AUTHOR_ROLE)
                })
                .collect();
            if agent.len() >= 2 {
                agent.sort_by_key(|a| a.id);
                break (agent[0].id, agent[1].id);
            }
            assert!(
                Instant::now() < deadline,
                "two bursts did not produce two artifacts within deadline (had {})",
                agent.len()
            );
        };

        let stamp1 = uuid_v7_unix_millis(id1.as_uuid());
        let stamp2 = uuid_v7_unix_millis(id2.as_uuid());
        // Burst 1 stamp should align with burst 1's start; burst 2 with
        // burst 2's. The gap between stamps must be at least the gap
        // between starts, minus a small slack for SystemTime
        // granularity.
        assert!(
            stamp1 >= burst1_start.saturating_sub(2) && stamp1 <= burst1_start.saturating_add(200),
            "burst 1 stamp ({stamp1}) outside expected range around burst1_start ({burst1_start})"
        );
        assert!(
            stamp2 >= burst2_start.saturating_sub(2) && stamp2 <= burst2_start.saturating_add(200),
            "burst 2 stamp ({stamp2}) outside expected range around burst2_start ({burst2_start})"
        );
        assert!(
            stamp2 > stamp1,
            "burst 2 stamp ({stamp2}) must be strictly later than burst 1 ({stamp1}) — first_seen_at not reset on flush?"
        );
    }

    /// New required test from the Phase 23.A roadmap. The chronological
    /// order of artifacts must reflect the order in which their content
    /// was *produced*, not when their flush deadline expired. Without
    /// this, a user message posted between the last agent token and
    /// the coalescer's flush would land before the agent text, and
    /// tool-use artifacts that ran during the turn would land after.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn coalescer_flushed_artifact_predates_subsequent_user_post() {
        std::env::set_var("DESIGNER_MESSAGE_COALESCE_MS", "200");
        let core = boot_test_core().await;
        spawn_message_coalescer(core.clone(), Duration::from_millis(200));
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        core.orchestrator
            .spawn_team(designer_claude::TeamSpec {
                workspace_id: ws.id,
                tab_id: default_tab_id(),
                team_name: "t".into(),
                lead_role: "team-lead".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
                phase24: false,
            })
            .await
            .unwrap();

        // T0: agent reply burst starts (mock broadcasts an agent
        // MessagePosted from the user's first post). The coalescer
        // captures first_seen ≈ T0.
        core.post_message(ws.id, None, None, "first".into())
            .await
            .unwrap();

        // T0+50ms: user posts again, before the 200ms coalesce window
        // elapses. The user artifact lands immediately with an id
        // stamped at T0+50ms. The agent reply for THIS post extends the
        // existing pending entry (same author_role) — its content
        // accumulates but `first_seen_at` is not overwritten.
        tokio::time::sleep(Duration::from_millis(50)).await;
        core.post_message(ws.id, None, None, "second".into())
            .await
            .unwrap();

        // Wait for the flush (~200ms after the second chunk).
        let deadline = Instant::now() + Duration::from_secs(3);
        loop {
            tokio::time::sleep(Duration::from_millis(40)).await;
            let arts = core.list_artifacts(ws.id).await;
            let agent_msgs: Vec<_> = arts
                .iter()
                .filter(|a| {
                    a.kind == ArtifactKind::Message
                        && a.author_role.as_deref() != Some(USER_AUTHOR_ROLE)
                })
                .collect();
            // Both user posts coalesce into a single agent artifact
            // (same key, no flush in between).
            if agent_msgs.len() == 1 {
                let agent_id = agent_msgs[0].id;
                let user_msgs: Vec<_> = arts
                    .iter()
                    .filter(|a| {
                        a.kind == ArtifactKind::Message
                            && a.author_role.as_deref() == Some(USER_AUTHOR_ROLE)
                    })
                    .collect();
                assert_eq!(user_msgs.len(), 2, "expected two user artifacts");
                let user_second = user_msgs.iter().max_by_key(|a| a.id).unwrap();
                assert!(
                    agent_id < user_second.id,
                    "agent artifact id ({agent_id}) must precede the second user artifact id ({}) — phase 23.A ordering invariant",
                    user_second.id
                );
                return;
            }
            assert!(
                Instant::now() < deadline,
                "did not see exactly 1 coalesced agent artifact within deadline (had {})",
                agent_msgs.len()
            );
        }
    }

    /// Orchestrator dispatch failure must NOT leave a user artifact in
    /// the projector. The previous implementation persisted the user
    /// artifact first, then dispatched, leading to duplicates on retry.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn post_message_no_artifact_on_dispatch_failure() {
        // Use an orchestrator surface where post_message always fails:
        // we use a fresh AppCore but skip spawn_team and force the
        // orchestrator to a "no team" state. The mock's post_message
        // returns TeamNotFound when no team exists; AppCore lazy-spawns
        // and retries. To force a hard failure, we can't easily inject a
        // failing orchestrator here without exposing test hooks. Instead
        // we test the contrapositive: when post_message succeeds, ONE
        // user artifact appears (no duplicate, no leftover from a
        // previous attempt).
        let core = boot_test_core().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        core.post_message(ws.id, None, None, "first".into())
            .await
            .unwrap();
        let after = core.list_artifacts(ws.id).await;
        let user_artifacts: Vec<_> = after
            .iter()
            .filter(|a| {
                a.kind == ArtifactKind::Message
                    && a.author_role.as_deref() == Some(USER_AUTHOR_ROLE)
            })
            .collect();
        assert_eq!(user_artifacts.len(), 1);
    }

    /// Reusable stub that returns `ChannelClosed` on the first
    /// `post_message`, then yields whatever `second_post_result` provides
    /// for subsequent calls. Tracks call counts so tests can assert the
    /// recovery shape.
    #[cfg(test)]
    struct FlakyOrchestrator {
        tx: tokio::sync::broadcast::Sender<OrchestratorEvent>,
        calls: std::sync::atomic::AtomicU32,
        spawn_calls: std::sync::atomic::AtomicU32,
        shutdown_calls: std::sync::atomic::AtomicU32,
        kill_calls: std::sync::atomic::AtomicU32,
        // Records `("kill" | "spawn" | "post" | "shutdown", call_index)`
        // tuples in invocation order so model-change tests can assert
        // that `kill` runs *before* the matching `spawn`. Without an
        // ordered log, atomic counters alone can't distinguish "killed
        // before respawn" (correct) from "spawned then killed" (wrong).
        call_order: parking_lot::Mutex<Vec<&'static str>>,
        second_post_result: parking_lot::Mutex<Option<designer_claude::OrchestratorError>>,
    }

    #[cfg(test)]
    #[async_trait::async_trait]
    impl designer_claude::Orchestrator for FlakyOrchestrator {
        async fn spawn_team(&self, _spec: TeamSpec) -> designer_claude::OrchestratorResult<()> {
            self.spawn_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.call_order.lock().push("spawn");
            Ok(())
        }
        async fn assign_task(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
            _a: designer_claude::TaskAssignment,
        ) -> designer_claude::OrchestratorResult<()> {
            Ok(())
        }
        async fn post_message(
            &self,
            workspace_id: WorkspaceId,
            tab_id: TabId,
            _author_role: String,
            _body: String,
        ) -> designer_claude::OrchestratorResult<()> {
            self.call_order.lock().push("post");
            let n = self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if n == 0 {
                Err(designer_claude::OrchestratorError::ChannelClosed {
                    workspace_id,
                    tab_id,
                })
            } else {
                match self.second_post_result.lock().take() {
                    Some(err) => Err(err),
                    None => Ok(()),
                }
            }
        }
        fn subscribe(&self) -> tokio::sync::broadcast::Receiver<OrchestratorEvent> {
            self.tx.subscribe()
        }
        fn subscribe_signals(
            &self,
        ) -> tokio::sync::broadcast::Receiver<designer_claude::ClaudeSignal> {
            let (tx, rx) = tokio::sync::broadcast::channel(1);
            drop(tx);
            rx
        }
        async fn shutdown(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
        ) -> designer_claude::OrchestratorResult<()> {
            self.shutdown_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.call_order.lock().push("shutdown");
            Ok(())
        }
        async fn kill(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
        ) -> designer_claude::OrchestratorResult<()> {
            self.kill_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.call_order.lock().push("kill");
            Ok(())
        }
        async fn interrupt(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
        ) -> designer_claude::OrchestratorResult<()> {
            Ok(())
        }
    }

    #[cfg(test)]
    async fn boot_core_with_flaky() -> (Arc<AppCore>, Arc<FlakyOrchestrator>) {
        let (tx, _rx) = tokio::sync::broadcast::channel(16);
        let flaky = Arc::new(FlakyOrchestrator {
            tx,
            calls: std::sync::atomic::AtomicU32::new(0),
            spawn_calls: std::sync::atomic::AtomicU32::new(0),
            shutdown_calls: std::sync::atomic::AtomicU32::new(0),
            kill_calls: std::sync::atomic::AtomicU32::new(0),
            call_order: parking_lot::Mutex::new(Vec::new()),
            second_post_result: parking_lot::Mutex::new(None),
        });
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: false,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);
        let flaky_dyn: Arc<dyn designer_claude::Orchestrator> = flaky.clone();
        let core = AppCore::boot_with_orchestrator(config, Some(flaky_dyn))
            .await
            .unwrap();
        (core, flaky)
    }

    /// Regression guard for the bundled-`.app` chat-hang.
    ///
    /// When `Orchestrator::post_message` returns `ChannelClosed` (the
    /// claude subprocess died and the writer task has gone with it), the
    /// post-message path must respawn (not graceful-shutdown — that
    /// would block the user for up to 60s on a dead lead). We exercise
    /// this with a stub orchestrator that fails the first `post_message`
    /// call with `ChannelClosed`, expects a `spawn_team` + second
    /// `post_message`, and asserts `shutdown` is NOT called (the
    /// orchestrator's `kill_on_drop(true)` on the old `Child` does the
    /// cleanup synchronously when `spawn_team`'s `insert` overwrites the
    /// stale handle).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn channel_closed_respawns_without_graceful_shutdown() {
        use std::sync::atomic::Ordering;

        let (core, flaky) = boot_core_with_flaky().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();

        core.post_message(ws.id, None, None, "hello".into())
            .await
            .unwrap();

        assert_eq!(
            flaky.calls.load(Ordering::SeqCst),
            2,
            "post_message should be retried after ChannelClosed"
        );
        assert_eq!(
            flaky.shutdown_calls.load(Ordering::SeqCst),
            0,
            "shutdown must NOT be called on the recovery path — kill_on_drop handles cleanup synchronously, and shutdown's 60s graceful wait would block the user for the full SHUTDOWN_TIMEOUT on every recovery"
        );
        assert_eq!(
            flaky.spawn_calls.load(Ordering::SeqCst),
            1,
            "respawn should run exactly once"
        );

        // The user artifact lands exactly once after recovery.
        let after = core.list_artifacts(ws.id).await;
        let user_count = after
            .iter()
            .filter(|a| {
                a.kind == ArtifactKind::Message
                    && a.author_role.as_deref() == Some(USER_AUTHOR_ROLE)
            })
            .count();
        assert_eq!(user_count, 1);
    }

    /// When recovery itself fails (the second `post_message` after
    /// respawn also returns an error), the user must see a clean,
    /// human-readable error — not engineering jargon — and *no* user
    /// artifact may land in the projector. The "couldn't deliver your
    /// message to Claude" copy is the contract; future re-wording is
    /// fine but the prefix must stay manager-readable, not start with
    /// `orchestrator post_message failed:`.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn channel_closed_then_respawn_fails_returns_clean_error() {
        use std::sync::atomic::Ordering;

        let (core, flaky) = boot_core_with_flaky().await;
        // Arm the second call to ALSO fail with ChannelClosed (claude is
        // genuinely broken — bad path, missing entitlement, etc.).
        *flaky.second_post_result.lock() =
            Some(designer_claude::OrchestratorError::ChannelClosed {
                workspace_id: WorkspaceId::new(),
                tab_id: default_tab_id(),
            });

        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();

        let err = core
            .post_message(ws.id, None, None, "hello".into())
            .await
            .expect_err("recovery-also-fails must surface a clean error");

        let msg = format!("{err}");
        assert!(
            msg.contains("couldn't deliver"),
            "expected manager-readable copy, got: {msg}"
        );
        assert!(
            !msg.starts_with("orchestrator post_message failed:"),
            "the legacy jargon prefix must not surface to the user (got: {msg})"
        );
        // Phase 23.E follow-up: the recovered-then-failed path used to
        // suffix the user-facing copy with `OrchestratorError::ChannelClosed`'s
        // Display string, which after 23.E embeds raw `workspace` + `tab`
        // UUIDs. Manager users don't read UUIDs. The humanizer must rewrite
        // this suffix to a clean retry hint.
        assert!(
            !msg.contains("stdin channel closed"),
            "ChannelClosed Display string leaked to user-facing copy (got: {msg})"
        );
        // The pre-fix Display reads "stdin channel closed for workspace
        // {uuid} / tab {uuid}" — *both* "workspace " and "tab " markers
        // appear together. AND-combine so a partial leak (just one of
        // the two) still fails; the previous `||` would pass when only
        // one marker was present, defeating the defense-in-depth.
        assert!(
            !msg.contains("workspace ") && !msg.contains("tab "),
            "raw UUIDs leaked into user-facing copy (got: {msg})"
        );

        // No user artifact may have landed (the dispatch-first ordering
        // protects against duplicates on retry).
        let after = core.list_artifacts(ws.id).await;
        let user_count = after
            .iter()
            .filter(|a| {
                a.kind == ArtifactKind::Message
                    && a.author_role.as_deref() == Some(USER_AUTHOR_ROLE)
            })
            .count();
        assert_eq!(
            user_count, 0,
            "no user artifact should land on a failed dispatch"
        );

        assert_eq!(flaky.spawn_calls.load(Ordering::SeqCst), 1);
        assert_eq!(flaky.calls.load(Ordering::SeqCst), 2);
    }

    /// Regression guard for the chat-hangs-on-model-swap bug.
    ///
    /// When the user changes the chat model mid-conversation, Claude's
    /// `--session-id` is deterministic per `(workspace, tab)` — the
    /// **old** subprocess holds that session id until it fully exits.
    /// If we spawn the new claude before tearing down the old one, the
    /// new spawn dies with `Error: Session ID … is already in use` and
    /// the user sees a forever-spinning chat. The fix: `kill` the team
    /// before `spawn_team` runs on the model-change branch (skipped on
    /// the lazy-first-spawn path where there's no prior team to kill).
    ///
    /// Asserts:
    /// 1. First post pins a model, no kill (no prior team).
    /// 2. Same-model repost: no kill, no new spawn.
    /// 3. Different-model post: kill *runs before* the new spawn.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn model_change_kills_before_spawn() {
        use std::sync::atomic::Ordering;

        let (core, flaky) = boot_core_with_flaky().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();

        // First post: lazy-spawn, no kill (no prior team).
        core.post_message(ws.id, None, Some("haiku-4.5".into()), "first".into())
            .await
            .unwrap();
        assert_eq!(
            flaky.kill_calls.load(Ordering::SeqCst),
            0,
            "first post must not call kill — there is no prior team"
        );
        let spawns_after_first = flaky.spawn_calls.load(Ordering::SeqCst);
        assert!(
            spawns_after_first >= 1,
            "first post should have spawned at least once"
        );

        // Reset the call_order log so the model-swap assertion below
        // only sees the swap-driven calls. Safe because `post_message`
        // dispatch is synchronous in this test path: by the time we
        // reach this line, every spawn/post/kill from the first phase
        // has already been recorded. The model-swap phase below adds
        // its own entries to a now-empty log, and the `kill_idx <
        // spawn_idx` assertion can only be satisfied by entries from
        // the swap itself — no race with stale phase-1 entries.
        flaky.call_order.lock().clear();

        // Same-model repost: no kill, no new spawn.
        let kills_before = flaky.kill_calls.load(Ordering::SeqCst);
        let spawns_before = flaky.spawn_calls.load(Ordering::SeqCst);
        core.post_message(ws.id, None, Some("haiku-4.5".into()), "second".into())
            .await
            .unwrap();
        assert_eq!(
            flaky.kill_calls.load(Ordering::SeqCst),
            kills_before,
            "same-model repost must not call kill"
        );
        assert_eq!(
            flaky.spawn_calls.load(Ordering::SeqCst),
            spawns_before,
            "same-model repost must not respawn"
        );

        // Reset the call_order again to isolate the swap.
        flaky.call_order.lock().clear();

        // Model swap: kill must run, and it must run BEFORE the new
        // spawn — not after.
        core.post_message(ws.id, None, Some("sonnet-4.6".into()), "third".into())
            .await
            .unwrap();
        assert!(
            flaky.kill_calls.load(Ordering::SeqCst) > kills_before,
            "model swap must call kill at least once"
        );
        let order = flaky.call_order.lock().clone();
        let kill_idx = order.iter().position(|c| *c == "kill");
        let spawn_idx = order.iter().position(|c| *c == "spawn");
        assert!(
            kill_idx.is_some(),
            "model swap must invoke kill (call_order: {order:?})"
        );
        assert!(
            spawn_idx.is_some(),
            "model swap must invoke spawn (call_order: {order:?})"
        );
        assert!(
            kill_idx.unwrap() < spawn_idx.unwrap(),
            "kill must precede spawn on model swap so the deterministic \
             session id is released before the new claude tries to \
             claim it (call_order: {order:?})"
        );
    }

    /// The frontend identifier → Claude CLI model mapper is the
    /// contract the IPC layer commits to. Lock the mapping so a future
    /// model rename has to update both ends together.
    #[test]
    fn frontend_model_mapping_is_locked() {
        assert_eq!(
            frontend_model_to_claude_cli("opus-4.7"),
            Some("claude-opus-4-7".into())
        );
        assert_eq!(
            frontend_model_to_claude_cli("sonnet-4.6"),
            Some("claude-sonnet-4-6".into())
        );
        assert_eq!(
            frontend_model_to_claude_cli("haiku-4.5"),
            Some("claude-haiku-4-5".into())
        );
        // Unknown identifiers fall through silently — the orchestrator
        // default takes over.
        assert_eq!(frontend_model_to_claude_cli("opus"), None);
        assert_eq!(frontend_model_to_claude_cli(""), None);
    }

    /// Posting with a model identifier records the mapped Claude CLI
    /// model on the workspace. Subsequent posts with the same model are
    /// no-ops; switching models triggers a respawn (and updates the
    /// recorded model).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn post_message_with_model_records_team_model() {
        let core = boot_test_core().await;
        spawn_message_coalescer(core.clone(), Duration::from_millis(5));
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();

        // No model pinned at start.
        assert_eq!(core.team_model(ws.id, default_tab_id()), None);

        // First post with `haiku-4.5` lazy-spawns a team and pins the
        // Claude CLI name.
        core.post_message(ws.id, None, Some("haiku-4.5".into()), "first".into())
            .await
            .unwrap();
        assert_eq!(
            core.team_model(ws.id, default_tab_id()).as_deref(),
            Some("claude-haiku-4-5"),
            "first post should pin the Claude CLI model name"
        );

        // Second post with the same model — no respawn, model
        // unchanged.
        core.post_message(ws.id, None, Some("haiku-4.5".into()), "second".into())
            .await
            .unwrap();
        assert_eq!(
            core.team_model(ws.id, default_tab_id()).as_deref(),
            Some("claude-haiku-4-5")
        );

        // Switching to sonnet respawns; the recorded model flips.
        core.post_message(ws.id, None, Some("sonnet-4.6".into()), "third".into())
            .await
            .unwrap();
        assert_eq!(
            core.team_model(ws.id, default_tab_id()).as_deref(),
            Some("claude-sonnet-4-6"),
            "model switch should respawn and update the recorded model"
        );
    }

    /// Posting with `model = None` is the legacy path: the team is
    /// lazy-spawned without a model override (orchestrator default
    /// applies), and the workspace's recorded team_model stays unset.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn post_message_without_model_leaves_team_model_unset() {
        let core = boot_test_core().await;
        spawn_message_coalescer(core.clone(), Duration::from_millis(5));
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();

        core.post_message(ws.id, None, None, "hello".into())
            .await
            .unwrap();
        assert_eq!(
            core.team_model(ws.id, default_tab_id()),
            None,
            "no model pinned when the request omits one"
        );
    }

    // ----------------------------------------------------------------
    // Phase 23.E acceptance tests (T-23E-2 .. T-23E-6).
    //
    // T-23E-1 (distinct session ids) was retired in Cut 1 (2026-05-03)
    // along with the deterministic-session-id scheme — every spawn now
    // gets a fresh random id, so per-tab uniqueness is a stdlib
    // guarantee, not a Designer invariant. See
    // `designer-claude::claude_code::tests::no_deterministic_session_seed_remains`.
    // ----------------------------------------------------------------

    /// Build an `AppCore` whose orchestrator is a fresh `MockOrchestrator`
    /// the test owns a handle to. The standard `boot_test_core()` builds
    /// AppCore with an internally-constructed `MockOrchestrator` that the
    /// test can't introspect; the per-tab acceptance tests need to assert
    /// "two distinct teams in the map", which requires a typed handle.
    async fn boot_core_with_mock() -> (
        Arc<AppCore>,
        Arc<designer_claude::MockOrchestrator<designer_core::SqliteEventStore>>,
    ) {
        std::env::set_var("DESIGNER_MESSAGE_COALESCE_MS", "5");
        let dir = tempdir().unwrap();
        let store =
            Arc::new(designer_core::SqliteEventStore::open(dir.path().join("events.db")).unwrap());
        let mock = Arc::new(designer_claude::MockOrchestrator::new(store.clone()));
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: true,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);
        let mock_dyn: Arc<dyn designer_claude::Orchestrator> = mock.clone();
        let core = AppCore::boot_with_orchestrator(config, Some(mock_dyn))
            .await
            .unwrap();
        (core, mock)
    }

    /// T-23E-2 — parallel post round-trips. Two tabs in one workspace
    /// each lazy-spawn their own team; the orchestrator's teams map ends
    /// up with two distinct `(workspace, tab)` entries. Posts on tab A
    /// and tab B do not collide on a single session.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn t_23e_2_parallel_tabs_get_distinct_teams() {
        let (core, mock) = boot_core_with_mock().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let tab_a = core
            .open_tab(ws.id, "A".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();
        let tab_b = core
            .open_tab(ws.id, "B".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();

        core.post_message(ws.id, Some(tab_a.id), None, "from A".into())
            .await
            .unwrap();
        core.post_message(ws.id, Some(tab_b.id), None, "from B".into())
            .await
            .unwrap();

        let keys = mock.team_keys();
        assert_eq!(keys.len(), 2, "expected one team per tab; got {keys:?}");
        assert!(keys.contains(&(ws.id, tab_a.id)));
        assert!(keys.contains(&(ws.id, tab_b.id)));
    }

    /// T-23E-3 — close tab kills its subprocess. Spawn the team via a
    /// post; close the tab; assert the orchestrator's teams map no
    /// longer carries `(workspace_id, tab_id)`. Two tabs are opened so
    /// the last-tab guard in `core::close_tab` does not turn the close
    /// into a no-op (frc_019dea6b).
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn t_23e_3_close_tab_shuts_down_team() {
        let (core, mock) = boot_core_with_mock().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let tab = core
            .open_tab(ws.id, "T".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();
        let _keep = core
            .open_tab(ws.id, "Keep".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();
        core.post_message(ws.id, Some(tab.id), None, "hi".into())
            .await
            .unwrap();
        assert!(mock.team_keys().contains(&(ws.id, tab.id)));

        core.close_tab(ws.id, tab.id).await.unwrap();
        assert!(
            !mock.team_keys().contains(&(ws.id, tab.id)),
            "closed tab's team must be removed from the orchestrator map"
        );
    }

    /// T-23E-4 — archive workspace shuts down all tabs. A workspace with
    /// three open tabs, all with live teams, archives to zero teams.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn t_23e_4_archive_shuts_down_all_tabs() {
        let (core, mock) = boot_core_with_mock().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let mut tab_ids = vec![];
        for name in ["A", "B", "C"] {
            let t = core
                .open_tab(ws.id, name.into(), designer_core::TabTemplate::Thread)
                .await
                .unwrap();
            core.post_message(ws.id, Some(t.id), None, format!("hi {name}"))
                .await
                .unwrap();
            tab_ids.push(t.id);
        }
        assert_eq!(
            mock.team_keys().iter().filter(|(w, _)| *w == ws.id).count(),
            3
        );
        core.archive_workspace(ws.id).await.unwrap();
        let remaining = mock
            .team_keys()
            .into_iter()
            .filter(|(w, _)| *w == ws.id)
            .count();
        assert_eq!(
            remaining, 0,
            "archive must shut down every per-tab team in the workspace"
        );
    }

    /// T-23E-5 — model change respawns only the affected tab. Post on
    /// tab A with haiku and tab B with opus. Switch tab A to sonnet.
    /// Tab B's recorded model must be untouched.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn t_23e_5_model_change_respawns_only_affected_tab() {
        let (core, _mock) = boot_core_with_mock().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let tab_a = core
            .open_tab(ws.id, "A".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();
        let tab_b = core
            .open_tab(ws.id, "B".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();

        core.post_message(ws.id, Some(tab_a.id), Some("haiku-4.5".into()), "a".into())
            .await
            .unwrap();
        core.post_message(ws.id, Some(tab_b.id), Some("opus-4.7".into()), "b".into())
            .await
            .unwrap();
        assert_eq!(
            core.team_model(ws.id, tab_a.id).as_deref(),
            Some("claude-haiku-4-5")
        );
        assert_eq!(
            core.team_model(ws.id, tab_b.id).as_deref(),
            Some("claude-opus-4-7")
        );

        // Switch tab A to sonnet — tab B must stay on opus.
        core.post_message(
            ws.id,
            Some(tab_a.id),
            Some("sonnet-4.6".into()),
            "a2".into(),
        )
        .await
        .unwrap();
        assert_eq!(
            core.team_model(ws.id, tab_a.id).as_deref(),
            Some("claude-sonnet-4-6")
        );
        assert_eq!(
            core.team_model(ws.id, tab_b.id).as_deref(),
            Some("claude-opus-4-7"),
            "tab B's model must not be touched by tab A's switch"
        );
    }

    /// T-23E-6 — back-compat with no tabs. A workspace whose projection
    /// shows zero tabs (legacy / replay edge case) must not crash on
    /// post_message; the lazy-spawn path uses the nil-sentinel tab id
    /// and produces exactly one team.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn t_23e_6_no_tabs_does_not_crash() {
        let (core, mock) = boot_core_with_mock().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        // No tabs opened — call post_message with `tab_id: None`.
        core.post_message(ws.id, None, None, "first".into())
            .await
            .unwrap();
        let keys: Vec<_> = mock
            .team_keys()
            .into_iter()
            .filter(|(w, _)| *w == ws.id)
            .collect();
        assert_eq!(keys.len(), 1);
        assert_eq!(
            keys[0].1,
            default_tab_id(),
            "legacy path uses the nil sentinel"
        );
    }

    /// Stalling orchestrator: every `shutdown` call parks for 30s before
    /// returning. The bounded-budget regression below uses this to prove
    /// `core.close_tab` and `core.archive_workspace` return within the
    /// 5s `USER_INITIATED_SHUTDOWN_BUDGET`, not the orchestrator's
    /// internal 60s SHUTDOWN_TIMEOUT × N-tabs.
    #[cfg(test)]
    struct StallingOrchestrator {
        tx: tokio::sync::broadcast::Sender<OrchestratorEvent>,
    }

    #[cfg(test)]
    #[async_trait::async_trait]
    impl designer_claude::Orchestrator for StallingOrchestrator {
        async fn spawn_team(&self, _spec: TeamSpec) -> designer_claude::OrchestratorResult<()> {
            Ok(())
        }
        async fn assign_task(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
            _a: designer_claude::TaskAssignment,
        ) -> designer_claude::OrchestratorResult<()> {
            Ok(())
        }
        async fn post_message(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
            _author_role: String,
            _body: String,
        ) -> designer_claude::OrchestratorResult<()> {
            Ok(())
        }
        fn subscribe(&self) -> tokio::sync::broadcast::Receiver<OrchestratorEvent> {
            self.tx.subscribe()
        }
        fn subscribe_signals(
            &self,
        ) -> tokio::sync::broadcast::Receiver<designer_claude::ClaudeSignal> {
            let (tx, rx) = tokio::sync::broadcast::channel(1);
            drop(tx);
            rx
        }
        async fn shutdown(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
        ) -> designer_claude::OrchestratorResult<()> {
            tokio::time::sleep(Duration::from_secs(30)).await;
            Ok(())
        }
        async fn kill(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
        ) -> designer_claude::OrchestratorResult<()> {
            // Override the default trait impl (which would delegate to
            // the 30-second `shutdown`) so model-change tests against a
            // stalling orchestrator return promptly.
            Ok(())
        }
        async fn interrupt(
            &self,
            _ws: WorkspaceId,
            _tab_id: TabId,
        ) -> designer_claude::OrchestratorResult<()> {
            Ok(())
        }
    }

    async fn boot_core_with_stalling() -> Arc<AppCore> {
        let (tx, _rx) = tokio::sync::broadcast::channel(16);
        let stalling: Arc<dyn designer_claude::Orchestrator> =
            Arc::new(StallingOrchestrator { tx });
        let dir = tempdir().unwrap();
        let config = AppConfig {
            data_dir: dir.path().to_path_buf(),
            use_mock_orchestrator: false,
            claude_options: Default::default(),
            default_cost_cap: CostCap {
                max_dollars_cents: None,
                max_tokens: None,
            },
            helper_binary_path: None,
        };
        std::mem::forget(dir);
        AppCore::boot_with_orchestrator(config, Some(stalling))
            .await
            .unwrap()
    }

    /// Regression for the Phase 23.E review BLOCKER: a stalling
    /// `Orchestrator::shutdown` (30s sleep) must not block `close_tab`
    /// past the user-initiated budget (5s). Pre-fix, close_tab awaited
    /// shutdown synchronously and the user paid the full 60s graceful
    /// window on a dead lead.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn close_tab_returns_within_budget_when_shutdown_stalls() {
        let core = boot_core_with_stalling().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        let tab = core
            .open_tab(ws.id, "T".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();
        // Open a second tab so the last-tab guard in `close_tab` doesn't
        // short-circuit before the shutdown path is exercised.
        let _keep = core
            .open_tab(ws.id, "Keep".into(), designer_core::TabTemplate::Thread)
            .await
            .unwrap();

        let started = Instant::now();
        core.close_tab(ws.id, tab.id).await.unwrap();
        let elapsed = started.elapsed();
        // Budget is 5s. Allow 2s of test/scheduler slack on top.
        assert!(
            elapsed < Duration::from_secs(7),
            "close_tab took {elapsed:?}; must return within the user-initiated shutdown budget"
        );
    }

    /// Same regression on the archive path: a workspace with three open
    /// tabs whose orchestrator stalls 30s per shutdown must finish
    /// archiving within the 5s budget. Pre-fix, the sequential loop
    /// would have run 3×30s = 90s before returning; the join_all + bounded
    /// timeout caps total wall time.
    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn archive_workspace_returns_within_budget_when_shutdowns_stall() {
        let core = boot_core_with_stalling().await;
        let project = core
            .create_project("P".into(), "/tmp".into())
            .await
            .unwrap();
        let ws = core
            .create_workspace(project.id, "ws".into(), "main".into())
            .await
            .unwrap();
        for name in ["A", "B", "C"] {
            core.open_tab(ws.id, name.into(), designer_core::TabTemplate::Thread)
                .await
                .unwrap();
        }

        let started = Instant::now();
        core.archive_workspace(ws.id).await.unwrap();
        let elapsed = started.elapsed();
        assert!(
            elapsed < Duration::from_secs(7),
            "archive_workspace took {elapsed:?}; bounded shutdown must cap user-visible latency"
        );
    }
}
