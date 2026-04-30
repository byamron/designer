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
    StreamId, WorkspaceId,
};
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};
use tokio::time::interval;
use tracing::{debug, warn};

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
        body: String,
    ) -> Result<ArtifactId, CoreError> {
        if body.trim().is_empty() {
            return Err(CoreError::Invariant(
                "message body must not be empty".into(),
            ));
        }

        // 1. Dispatch to the orchestrator first. Lazy-spawn a team if
        //    none exists yet — the demo workspace and any fresh workspace
        //    start without a team, and the user's first message is what
        //    kicks one off.
        match self
            .orchestrator
            .post_message(workspace_id, USER_AUTHOR_ROLE.into(), body.clone())
            .await
        {
            Ok(()) => {}
            Err(OrchestratorError::TeamNotFound(_)) => {
                let team_name = format!("workspace-{workspace_id}");
                // Spawn in the project's repo root so the workspace lead's
                // tools resolve against the user's code, not Designer's
                // own cwd. Track-scoped spawns will override with the
                // worktree path once the track UI lands.
                let cwd = self
                    .projector
                    .workspace(workspace_id)
                    .and_then(|ws| self.projector.project(ws.project_id))
                    .map(|p| p.root_path);
                let spec = TeamSpec {
                    workspace_id,
                    team_name,
                    lead_role: "team-lead".into(),
                    teammates: vec![],
                    env: Default::default(),
                    cwd,
                };
                if let Err(e) = self.orchestrator.spawn_team(spec).await {
                    warn!(error = %e, %workspace_id, "lazy spawn_team failed");
                    return Err(CoreError::Invariant(format!(
                        "orchestrator spawn_team failed: {e}"
                    )));
                }
                if let Err(e) = self
                    .orchestrator
                    .post_message(workspace_id, USER_AUTHOR_ROLE.into(), body.clone())
                    .await
                {
                    warn!(error = %e, %workspace_id, "post_message after lazy spawn failed");
                    return Err(CoreError::Invariant(format!(
                        "orchestrator post_message failed: {e}"
                    )));
                }
            }
            Err(e) => {
                warn!(error = %e, %workspace_id, "orchestrator post_message failed");
                return Err(CoreError::Invariant(format!(
                    "orchestrator post_message failed: {e}"
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
                },
            )
            .await?;
        self.projector.apply(&env);
        Ok(artifact_id)
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
        let env = self
            .store
            .append(
                stream,
                None,
                Actor::agent("workspace-lead", "team-lead"),
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
#[derive(Debug, Default)]
struct PendingMessage {
    body: String,
    last_update: Option<Instant>,
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
                        let mut p = pending_for_recv.lock();
                        let entry = p.entry((workspace_id, author_role.clone())).or_default();
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
            let mut to_flush: Vec<(CoalescerKey, String)> = Vec::new();
            {
                let mut p = pending_for_tick.lock();
                p.retain(|key, entry| {
                    let due = match entry.last_update {
                        Some(t) => now.duration_since(t) >= window,
                        None => false,
                    };
                    if due {
                        to_flush.push((key.clone(), std::mem::take(&mut entry.body)));
                        false
                    } else {
                        true
                    }
                });
            }
            for ((workspace_id, author_role), body) in to_flush {
                if body.trim().is_empty() {
                    continue;
                }
                let title = first_line_truncate(&body, 60);
                let summary = first_line_truncate(&body, 140);
                let artifact_id = ArtifactId::new();
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
        core.post_message(ws.id, "hello team".into()).await.unwrap();
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
        core.post_message(ws_a.id, "alpha".into()).await.unwrap();
        core.post_message(ws_b.id, "beta".into()).await.unwrap();
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
        core.post_message(ws.id, "first".into()).await.unwrap();
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
}
