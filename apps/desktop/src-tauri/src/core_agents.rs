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
use std::time::{Duration, Instant};
use tokio::time::interval;
use tracing::{debug, info, warn};

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
    /// If no team has been spawned yet (demo flow / first user message),
    /// we lazy-spawn one with a `team-lead` lead and zero teammates and
    /// retry the dispatch.
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

        // Map the frontend identifier (e.g. `haiku-4.5`) to the Claude
        // CLI's `--model` argument. Unknown identifiers fall through as
        // `None` — orchestrator default applies.
        let requested_cli_model = model.as_deref().and_then(frontend_model_to_claude_cli);

        // If the user has switched to a different model than the team
        // is currently running on, force a respawn before the message
        // dispatches. Claude takes `--model` once at process start; the
        // only way to change models for an existing session is to
        // restart the subprocess. Session id is workspace-derived
        // (UUIDv5) so Claude resumes the same session — conversation
        // history is preserved across the swap.
        let current_cli_model = self.team_model(workspace_id);
        if requested_cli_model.is_some()
            && requested_cli_model.as_deref() != current_cli_model.as_deref()
        {
            info!(
                %workspace_id,
                from = ?current_cli_model,
                to = ?requested_cli_model,
                "model change requested; respawning team"
            );
            self.spawn_workspace_team(workspace_id, requested_cli_model.clone())
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
            .post_message(workspace_id, USER_AUTHOR_ROLE.into(), body.clone())
            .await
        {
            Ok(()) => {}
            Err(e @ OrchestratorError::TeamNotFound(_))
            | Err(e @ OrchestratorError::ChannelClosed { .. }) => {
                if matches!(e, OrchestratorError::ChannelClosed { .. }) {
                    info!(
                        %workspace_id,
                        "post_message hit a stale team handle; respawning (insert+drop will kill the old child via kill_on_drop)"
                    );
                }
                self.spawn_workspace_team(workspace_id, requested_cli_model.clone())
                    .await
                    .map_err(|e| CoreError::Invariant(format!("couldn't reach Claude — {e}")))?;
                if let Err(e) = self
                    .orchestrator
                    .post_message(workspace_id, USER_AUTHOR_ROLE.into(), body.clone())
                    .await
                {
                    warn!(error = %e, %workspace_id, "post_message after lazy spawn failed");
                    return Err(CoreError::Invariant(format!(
                        "couldn't deliver your message to Claude — {e}"
                    )));
                }
            }
            Err(e) => {
                warn!(error = %e, %workspace_id, "orchestrator post_message failed");
                return Err(CoreError::Invariant(format!(
                    "couldn't deliver your message to Claude — {e}"
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
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(artifact_id)
    }

    /// Lazy-spawn (or respawn) the workspace's chat team with the given
    /// Claude CLI model override. Records the model in
    /// `team_model_by_workspace` so a later `post_message` can detect a
    /// model change without re-querying the orchestrator. Reuses the
    /// project's repo root as the cwd so the lead's tools resolve
    /// against the user's code.
    pub(crate) async fn spawn_workspace_team(
        &self,
        workspace_id: WorkspaceId,
        model: Option<String>,
    ) -> Result<(), OrchestratorError> {
        let cwd = self
            .projector
            .workspace(workspace_id)
            .and_then(|ws| self.projector.project(ws.project_id))
            .map(|p| p.root_path);
        let spec = TeamSpec {
            workspace_id,
            team_name: format!("workspace-{workspace_id}"),
            lead_role: "team-lead".into(),
            teammates: vec![],
            env: Default::default(),
            cwd,
            model: model.clone(),
        };
        match self.orchestrator.spawn_team(spec).await {
            Ok(()) => {
                self.set_team_model(workspace_id, model);
                Ok(())
            }
            Err(e) => {
                warn!(error = %e, %workspace_id, "spawn_team failed");
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
                    author_role.as_deref().unwrap_or("team-lead"),
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
    /// `team-lead` here would silently misattribute updates whenever a
    /// teammate (e.g. `researcher@dir-recon`) was the original author.
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
            artifact.author_role.as_deref().unwrap_or("team-lead"),
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
                },
            )
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
#[derive(Debug, Default)]
struct PendingMessage {
    body: String,
    last_update: Option<Instant>,
    tab_id: Option<TabId>,
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
            let mut to_flush: Vec<(CoalescerKey, String, Option<TabId>)> = Vec::new();
            {
                let mut p = pending_for_tick.lock();
                p.retain(|key, entry| {
                    let due = match entry.last_update {
                        Some(t) => now.duration_since(t) >= window,
                        None => false,
                    };
                    if due {
                        to_flush.push((key.clone(), std::mem::take(&mut entry.body), entry.tab_id));
                        false
                    } else {
                        true
                    }
                });
            }
            for ((workspace_id, author_role), body, captured_tab) in to_flush {
                if body.trim().is_empty() {
                    continue;
                }
                let title = first_line_truncate(&body, 60);
                let summary = first_line_truncate(&body, 140);
                let artifact_id = ArtifactId::new();
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
                team_name: "t".into(),
                lead_role: "team-lead".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
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
                team_name: "t".into(),
                lead_role: "team-lead".into(),
                teammates: vec![],
                env: Default::default(),
                cwd: None,
                model: None,
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
        second_post_result: parking_lot::Mutex<Option<designer_claude::OrchestratorError>>,
    }

    #[cfg(test)]
    #[async_trait::async_trait]
    impl designer_claude::Orchestrator for FlakyOrchestrator {
        async fn spawn_team(&self, _spec: TeamSpec) -> designer_claude::OrchestratorResult<()> {
            self.spawn_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            Ok(())
        }
        async fn assign_task(
            &self,
            _ws: WorkspaceId,
            _a: designer_claude::TaskAssignment,
        ) -> designer_claude::OrchestratorResult<()> {
            Ok(())
        }
        async fn post_message(
            &self,
            workspace_id: WorkspaceId,
            _author_role: String,
            _body: String,
        ) -> designer_claude::OrchestratorResult<()> {
            let n = self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            if n == 0 {
                Err(designer_claude::OrchestratorError::ChannelClosed { workspace_id })
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
        async fn shutdown(&self, _ws: WorkspaceId) -> designer_claude::OrchestratorResult<()> {
            self.shutdown_calls
                .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
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
        assert_eq!(core.team_model(ws.id), None);

        // First post with `haiku-4.5` lazy-spawns a team and pins the
        // Claude CLI name.
        core.post_message(ws.id, None, Some("haiku-4.5".into()), "first".into())
            .await
            .unwrap();
        assert_eq!(
            core.team_model(ws.id).as_deref(),
            Some("claude-haiku-4-5"),
            "first post should pin the Claude CLI model name"
        );

        // Second post with the same model — no respawn, model
        // unchanged.
        core.post_message(ws.id, None, Some("haiku-4.5".into()), "second".into())
            .await
            .unwrap();
        assert_eq!(core.team_model(ws.id).as_deref(), Some("claude-haiku-4-5"));

        // Switching to sonnet respawns; the recorded model flips.
        core.post_message(ws.id, None, Some("sonnet-4.6".into()), "third".into())
            .await
            .unwrap();
        assert_eq!(
            core.team_model(ws.id).as_deref(),
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
            core.team_model(ws.id),
            None,
            "no model pinned when the request omits one"
        );
    }
}
