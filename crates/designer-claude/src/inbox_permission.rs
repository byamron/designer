//! `InboxPermissionHandler` — the production permission handler for Phase 13.G.
//!
//! Routes every Claude permission prompt into the user-visible approval inbox:
//!
//! 1. Generates a fresh `ApprovalId` (UUIDv4 — no collision risk across
//!    workspaces).
//! 2. Emits `ApprovalRequested` on the workspace stream so the audit log and
//!    projector see the request.
//! 3. Emits `ArtifactCreated { kind: "approval", payload: inline(json) }` so
//!    the request shows up inline in the workspace thread (the
//!    `ApprovalBlock` renderer is already wired in `packages/app`).
//! 4. Parks the agent (`tokio::sync::oneshot` await + 5-minute deadline).
//!    Resolution arrives via `InboxPermissionHandler::resolve` from the IPC
//!    layer.
//! 5. On timeout, emits `ApprovalDenied { reason: "timeout" }` and tells the
//!    agent to deny — never blocks the agent forever.
//!
//! Replaces `AutoAcceptSafeTools` as the production default per ADR 0002
//! §"PermissionHandler" via `ClaudeCodeOrchestrator::with_permission_handler`.
//! Tests still use `AutoAcceptSafeTools` (no inbox round-trip needed for the
//! safe-prefix coverage).

use crate::permission::{PermissionDecision, PermissionHandler, PermissionRequest};
use async_trait::async_trait;
use dashmap::DashMap;
use designer_core::{
    Actor, ApprovalId, ArtifactId, ArtifactKind, EventPayload, EventStore, PayloadRef, StreamId,
};
use serde_json::json;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::oneshot;
use tracing::{debug, warn};

/// Hard ceiling on how long an agent can sit blocked on a single prompt.
/// Long enough for a real human round-trip (interrupted lunch, context
/// switch); short enough that an agent doesn't appear permanently stalled
/// when the user closed the laptop. Per spec Decision 22 (gates in core,
/// non-bypassable) the timeout is enforced here, not in the UI.
pub const APPROVAL_TIMEOUT: Duration = Duration::from_secs(5 * 60);

/// Token Designer writes into `ApprovalDenied.reason` when the inbox
/// timed out before the user resolved. Stable string so frontend / audit
/// queries can pattern-match without parsing free text.
pub const TIMEOUT_REASON: &str = "timeout";

/// Token used when AppCore boots and finds an `ApprovalRequested` with no
/// matching grant/deny — the original requesting subprocess is gone, so
/// auto-deny so the projector reflects reality and the inbox doesn't fill
/// up with phantom rows on every restart (per the staff-engineer review's
/// "replay safety" concern).
pub const PROCESS_RESTART_REASON: &str = "process_restart";

/// Routes Claude permission prompts through the user-visible approval inbox.
///
/// Construction is cheap; one per `AppCore` is enough — multiple
/// `ClaudeCodeOrchestrator` instances can share the same handler.
pub struct InboxPermissionHandler<S: EventStore> {
    store: Arc<S>,
    pending: Arc<DashMap<ApprovalId, oneshot::Sender<PermissionDecision>>>,
    timeout: Duration,
}

impl<S: EventStore> InboxPermissionHandler<S> {
    pub fn new(store: Arc<S>) -> Self {
        Self {
            store,
            pending: Arc::new(DashMap::new()),
            timeout: APPROVAL_TIMEOUT,
        }
    }

    /// Visible-for-tests timeout override. Production callers should use
    /// `new` and the default 5-minute timeout.
    #[doc(hidden)]
    pub fn with_timeout(store: Arc<S>, timeout: Duration) -> Self {
        Self {
            store,
            pending: Arc::new(DashMap::new()),
            timeout,
        }
    }

    /// Resolve a parked approval. Called by `cmd_resolve_approval` once the
    /// user clicks Grant or Deny in the `ApprovalBlock`.
    ///
    /// Idempotent: a second resolve for the same id is a no-op (the first
    /// one already woke the agent and dropped the channel). Returns whether
    /// a parked request was actually found — useful for logging "stale
    /// resolve" cases without erroring.
    pub async fn resolve(
        &self,
        approval_id: ApprovalId,
        granted: bool,
        reason: Option<String>,
    ) -> Result<bool, designer_core::CoreError> {
        // Persist the decision first — the event log is the source of truth.
        // The agent-wakeup is a side effect that follows.
        let payload = if granted {
            EventPayload::ApprovalGranted { approval_id }
        } else {
            EventPayload::ApprovalDenied {
                approval_id,
                reason: reason.clone(),
            }
        };
        self.store
            .append(StreamId::System, None, Actor::user(), payload)
            .await?;

        let Some((_, tx)) = self.pending.remove(&approval_id) else {
            // Already resolved (or this id never existed). Persisting the
            // event is still useful for audit; don't error.
            debug!(%approval_id, "resolve called for unknown approval");
            return Ok(false);
        };

        let decision = if granted {
            PermissionDecision::Accept
        } else {
            PermissionDecision::Deny {
                reason: reason.unwrap_or_else(|| "denied".into()),
            }
        };
        // Receiver may have been dropped (race with timeout). Either way the
        // agent is no longer waiting; the grant/deny event is already logged.
        let _ = tx.send(decision);
        Ok(true)
    }

    /// Read snapshot of approval ids the handler is currently parked on.
    /// Used by `cmd_list_pending_approvals` to seed the inbox view; the
    /// rendered detail (gate, summary) comes from the projected approval
    /// artifacts, not from this list.
    pub fn pending_ids(&self) -> Vec<ApprovalId> {
        self.pending.iter().map(|e| *e.key()).collect()
    }
}

#[async_trait]
impl<S: EventStore + 'static> PermissionHandler for InboxPermissionHandler<S> {
    async fn decide(&self, req: PermissionRequest) -> PermissionDecision {
        // The inbox needs a workspace to anchor the artifact + audit row. If
        // 13.D's stdio reader hasn't been updated to attach one yet, fail
        // closed — denying is safer than silently dropping the prompt and
        // letting the agent proceed.
        let Some(workspace_id) = req.workspace_id else {
            warn!(tool = %req.tool, "inbox handler invoked without workspace_id; denying");
            return PermissionDecision::Deny {
                reason: "inbox handler requires workspace_id (Phase 13.D wiring incomplete)".into(),
            };
        };

        let approval_id = ApprovalId::new();
        let artifact_id = ArtifactId::new();
        let gate = format!("tool:{}", req.tool);

        // Pack the payload so the ApprovalBlock can render gate + reason +
        // approval_id without a follow-up fetch. Keep it tight — the block
        // reads `summary` for the headline and `payload.body` (this JSON)
        // for the action surface.
        let payload_body = json!({
            "approval_id": approval_id,
            "tool": req.tool,
            "gate": gate,
            "summary": req.summary,
            "input": req.input,
        })
        .to_string();

        // 1. Emit the approval-requested domain event.
        if let Err(err) = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::system(),
                EventPayload::ApprovalRequested {
                    approval_id,
                    workspace_id,
                    gate: gate.clone(),
                    summary: req.summary.clone(),
                },
            )
            .await
        {
            warn!(error = %err, %approval_id, "failed to append ApprovalRequested; denying");
            return PermissionDecision::Deny {
                reason: "inbox handler failed to record approval request".into(),
            };
        }

        // 2. Emit the inline artifact so it shows up in the thread.
        let title = format!("Approval: {}", req.tool);
        if let Err(err) = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                Actor::system(),
                EventPayload::ArtifactCreated {
                    artifact_id,
                    workspace_id,
                    artifact_kind: ArtifactKind::Approval,
                    title,
                    summary: req.summary.clone(),
                    payload: PayloadRef::inline(payload_body),
                    author_role: Some("system".into()),
                },
            )
            .await
        {
            // Approval request already logged; surfacing failed. Deny rather
            // than silently letting the agent proceed.
            warn!(error = %err, %artifact_id, "failed to append approval artifact; denying");
            return PermissionDecision::Deny {
                reason: "inbox handler failed to surface approval artifact".into(),
            };
        }

        // 3. Park until resolved (or timeout).
        let (tx, rx) = oneshot::channel::<PermissionDecision>();
        self.pending.insert(approval_id, tx);

        match tokio::time::timeout(self.timeout, rx).await {
            Ok(Ok(decision)) => decision,
            Ok(Err(_)) => {
                // Sender dropped without sending — should not happen unless
                // the handler itself is being torn down. Deny safely.
                self.pending.remove(&approval_id);
                PermissionDecision::Deny {
                    reason: "approval channel closed unexpectedly".into(),
                }
            }
            Err(_) => {
                // Timeout fired. Drop the parked sender, log a denial, and
                // tell the agent to deny.
                self.pending.remove(&approval_id);
                let timeout_reason = Some(TIMEOUT_REASON.to_string());
                if let Err(err) = self
                    .store
                    .append(
                        StreamId::System,
                        None,
                        Actor::system(),
                        EventPayload::ApprovalDenied {
                            approval_id,
                            reason: timeout_reason.clone(),
                        },
                    )
                    .await
                {
                    warn!(error = %err, %approval_id, "failed to append timeout denial");
                }
                PermissionDecision::Deny {
                    reason: TIMEOUT_REASON.into(),
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::{SqliteEventStore, StreamOptions, WorkspaceId};
    use serde_json::Value;
    use std::sync::Arc;
    use tempfile::tempdir;

    async fn boot_store() -> Arc<SqliteEventStore> {
        let dir = tempdir().unwrap();
        let store = Arc::new(SqliteEventStore::open(dir.path().join("events.db")).unwrap());
        std::mem::forget(dir);
        store
    }

    fn req_with(workspace_id: WorkspaceId) -> PermissionRequest {
        PermissionRequest {
            tool: "Write".into(),
            input: json!({"path": "/tmp/x"}),
            summary: "Write to /tmp/x".into(),
            workspace_id: Some(workspace_id),
        }
    }

    #[tokio::test]
    async fn missing_workspace_id_denies_immediately() {
        let store = boot_store().await;
        let handler = InboxPermissionHandler::new(store);
        let decision = handler
            .decide(PermissionRequest {
                tool: "Write".into(),
                input: json!({}),
                summary: "no ws".into(),
                workspace_id: None,
            })
            .await;
        assert!(matches!(decision, PermissionDecision::Deny { .. }));
    }

    #[tokio::test]
    async fn grant_round_trip_emits_request_artifact_and_grant() {
        let store = boot_store().await;
        let handler = Arc::new(InboxPermissionHandler::new(store.clone()));
        let ws = WorkspaceId::new();

        // Park the agent.
        let h = handler.clone();
        let handle = tokio::spawn(async move { h.decide(req_with(ws)).await });

        // Wait until the parked entry shows up.
        let approval_id = wait_for_pending(&handler).await;

        // Resolve → Grant.
        let resolved = handler.resolve(approval_id, true, None).await.unwrap();
        assert!(resolved);

        let decision = handle.await.unwrap();
        assert_eq!(decision, PermissionDecision::Accept);

        // Event log: ApprovalRequested + ArtifactCreated + ApprovalGranted.
        let events = store.read_all(StreamOptions::default()).await.unwrap();
        let kinds: Vec<String> = events
            .iter()
            .map(|e| {
                serde_json::to_value(e.kind())
                    .unwrap()
                    .as_str()
                    .unwrap()
                    .to_string()
            })
            .collect();
        assert!(kinds.contains(&"approval_requested".to_string()));
        assert!(kinds.contains(&"artifact_created".to_string()));
        assert!(kinds.contains(&"approval_granted".to_string()));

        // The artifact carries an `approval_id` in its payload body —
        // confirms the ApprovalBlock can wire optimistic UI to the event.
        let artifact = events
            .iter()
            .find(|e| matches!(e.payload, EventPayload::ArtifactCreated { .. }))
            .unwrap();
        if let EventPayload::ArtifactCreated { payload, .. } = &artifact.payload {
            let PayloadRef::Inline { body } = payload else {
                panic!("expected inline payload");
            };
            let parsed: Value = serde_json::from_str(body).unwrap();
            // `ApprovalId` serializes transparently as a bare UUID
            // (`#[serde(transparent)]`); the `Display` `apv_<uuid>` form
            // is for logs, not the wire. The block parses the JSON and
            // matches on this UUID against `approval_granted/denied` events.
            let serialized = serde_json::to_value(approval_id).unwrap();
            assert_eq!(parsed.get("approval_id"), Some(&serialized));
        } else {
            panic!("expected ArtifactCreated");
        }
    }

    #[tokio::test]
    async fn deny_round_trip_returns_deny_with_reason() {
        let store = boot_store().await;
        let handler = Arc::new(InboxPermissionHandler::new(store.clone()));
        let ws = WorkspaceId::new();

        let h = handler.clone();
        let handle = tokio::spawn(async move { h.decide(req_with(ws)).await });
        let approval_id = wait_for_pending(&handler).await;

        handler
            .resolve(approval_id, false, Some("user said no".into()))
            .await
            .unwrap();

        let decision = handle.await.unwrap();
        match decision {
            PermissionDecision::Deny { reason } => assert_eq!(reason, "user said no"),
            other => panic!("expected deny, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn timeout_emits_denied_and_returns_deny() {
        let store = boot_store().await;
        // Tight timeout so the test runs in milliseconds.
        let handler =
            InboxPermissionHandler::with_timeout(store.clone(), Duration::from_millis(80));
        let ws = WorkspaceId::new();

        let decision = handler.decide(req_with(ws)).await;
        match decision {
            PermissionDecision::Deny { reason } => assert_eq!(reason, TIMEOUT_REASON),
            other => panic!("expected timeout deny, got {other:?}"),
        }

        let events = store.read_all(StreamOptions::default()).await.unwrap();
        let denied = events.iter().any(|e| {
            matches!(
                &e.payload,
                EventPayload::ApprovalDenied { reason, .. }
                    if reason.as_deref() == Some(TIMEOUT_REASON)
            )
        });
        assert!(denied, "expected ApprovalDenied with timeout reason");
    }

    #[tokio::test(flavor = "multi_thread", worker_threads = 2)]
    async fn racing_approvals_resolve_independently() {
        let store = boot_store().await;
        let handler = Arc::new(InboxPermissionHandler::new(store.clone()));
        let ws = WorkspaceId::new();

        // Park approval A, wait until it sits in `pending`, then park
        // approval B. Sequencing the spawns around `wait_for_pending`
        // guarantees both ids exist before we resolve, regardless of how
        // the runtime interleaves the two tasks.
        let h1 = handler.clone();
        let handle_a = tokio::spawn(async move { h1.decide(req_with(ws)).await });
        let id_a = wait_for_pending(&handler).await;

        let h2 = handler.clone();
        let handle_b = tokio::spawn(async move { h2.decide(req_with(ws)).await });
        // Wait until two ids are parked.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
        while handler.pending.len() < 2 {
            if tokio::time::Instant::now() >= deadline {
                panic!(
                    "second approval never parked (saw {})",
                    handler.pending.len()
                );
            }
            tokio::time::sleep(Duration::from_millis(10)).await;
        }
        let id_b = handler
            .pending_ids()
            .into_iter()
            .find(|id| *id != id_a)
            .expect("second pending id");

        // Resolve in reverse order to confirm routing by id, not order.
        handler.resolve(id_b, true, None).await.unwrap();
        handler
            .resolve(id_a, false, Some("nope".into()))
            .await
            .unwrap();

        let dec_a = handle_a.await.unwrap();
        let dec_b = handle_b.await.unwrap();
        assert!(matches!(dec_a, PermissionDecision::Deny { .. }));
        assert!(matches!(dec_b, PermissionDecision::Accept));
    }

    async fn wait_for_pending<S: EventStore>(
        handler: &Arc<InboxPermissionHandler<S>>,
    ) -> ApprovalId {
        let deadline = tokio::time::Instant::now() + Duration::from_secs(2);
        loop {
            if let Some(id) = handler.pending_ids().into_iter().next() {
                return id;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("no approval ever parked");
            }
            tokio::time::sleep(Duration::from_millis(5)).await;
        }
    }
}
