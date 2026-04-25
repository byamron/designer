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
use std::sync::Arc;
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
    /// Persist the user's message in the workspace and dispatch the body to
    /// the orchestrator. Two events land synchronously (so the projector
    /// sees them before this returns):
    ///
    /// 1. `MessagePosted { author: User, body }` — the durable thread entry.
    /// 2. `ArtifactCreated { kind: Message, author_role: "user" }` — the
    ///    block the unified thread renders.
    ///
    /// After the local appends, we call `Orchestrator::post_message`. If no
    /// team has been spawned yet (demo flow / first user message), we
    /// lazy-spawn one with a `team-lead` lead and zero teammates and retry.
    /// The user's text is durable regardless of whether the subprocess is
    /// healthy — we never lose the draft to a dead orchestrator.
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

        // 1. Append the user's MessagePosted event.
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

        // 2. Append the ArtifactCreated for the user message.
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
                    payload: PayloadRef::inline(body.clone()),
                    author_role: Some(USER_AUTHOR_ROLE.into()),
                },
            )
            .await?;
        self.projector.apply(&env);

        // 3. Dispatch to the orchestrator. Lazy-spawn a team if none exists
        //    yet — the demo workspace and any fresh workspace start without
        //    a team, and the user's first message is what kicks one off.
        match self
            .orchestrator
            .post_message(workspace_id, USER_AUTHOR_ROLE.into(), body.clone())
            .await
        {
            Ok(()) => {}
            Err(OrchestratorError::TeamNotFound(_)) => {
                let team_name = format!("workspace-{workspace_id}");
                let spec = TeamSpec {
                    workspace_id,
                    team_name,
                    lead_role: "team-lead".into(),
                    teammates: vec![],
                    env: Default::default(),
                };
                if let Err(e) = self.orchestrator.spawn_team(spec).await {
                    warn!(error = %e, %workspace_id, "lazy spawn_team failed");
                    return Err(CoreError::Invariant(format!(
                        "orchestrator spawn_team failed: {e}"
                    )));
                }
                if let Err(e) = self
                    .orchestrator
                    .post_message(workspace_id, USER_AUTHOR_ROLE.into(), body)
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

        Ok(artifact_id)
    }

    /// Append an agent-produced artifact (diagram or report) directly. The
    /// translator extension that wires real Claude tool-use calls into this
    /// path lands per-tool as we observe the tool-use shapes; until then,
    /// MockOrchestrator's keyword-driven simulator (see `mock.rs::post_message`)
    /// emits `OrchestratorEvent::ArtifactProduced` and the coalescer routes
    /// those into here. Caller chooses the kind; only `Diagram` and `Report`
    /// are accepted in 13.D — other kinds belong to E/F/G.
    pub async fn emit_agent_artifact(
        &self,
        workspace_id: WorkspaceId,
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
        let artifact_id = ArtifactId::new();
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
pub fn spawn_message_coalescer(core: Arc<AppCore>, window: Duration) {
    let mut rx = core.orchestrator.subscribe();
    let pending: Arc<Mutex<HashMap<CoalescerKey, PendingMessage>>> =
        Arc::new(Mutex::new(HashMap::new()));

    let pending_for_recv = pending.clone();
    let pending_for_tick = pending.clone();
    let core_for_tick = core.clone();

    // Receive task: accumulates bodies into the per-key pending state. We
    // never flush from this side — the tick task owns flush — to avoid
    // racing two writers against the same key.
    tokio::spawn(async move {
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
                        artifact_kind,
                        title,
                        summary,
                        body,
                        author_role,
                    } => {
                        // Tool-call artifacts bypass the coalescer — each
                        // tool call is one logical artifact. Hand off to a
                        // small spawned task so the recv loop keeps
                        // draining the broadcast channel.
                        let core = core.clone();
                        tokio::spawn(async move {
                            if let Err(e) = core
                                .emit_agent_artifact(
                                    workspace_id,
                                    artifact_kind,
                                    title,
                                    summary,
                                    body,
                                    author_role,
                                )
                                .await
                            {
                                warn!(error = %e, "emit_agent_artifact failed");
                            }
                        });
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
    tokio::spawn(async move {
        let mut ticker = interval(COALESCE_TICK);
        loop {
            ticker.tick().await;
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
                let res = core_for_tick
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
                    Ok(env) => core_for_tick.projector.apply(&env),
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
}
