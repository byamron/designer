//! Approval gates. An agent requests approval for a gated action, the user
//! grants or denies, the agent proceeds only on grant. Every step emits a
//! Designer event — the gate itself is thin state over the event store.

use async_trait::async_trait;
use designer_core::{
    Actor, ApprovalId, EventEnvelope, EventPayload, EventStore, Result, StreamId, StreamOptions,
    WorkspaceId,
};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalRequest {
    pub id: ApprovalId,
    pub workspace_id: WorkspaceId,
    pub gate: String,
    pub summary: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Pending,
    Granted,
    Denied,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApprovalDecision {
    pub id: ApprovalId,
    pub status: ApprovalStatus,
    pub reason: Option<String>,
}

#[async_trait]
pub trait ApprovalGate: Send + Sync {
    async fn request(&self, req: ApprovalRequest, actor: Actor) -> Result<EventEnvelope>;
    async fn grant(&self, id: ApprovalId, actor: Actor) -> Result<EventEnvelope>;
    async fn deny(
        &self,
        id: ApprovalId,
        reason: Option<String>,
        actor: Actor,
    ) -> Result<EventEnvelope>;
    async fn status(&self, id: ApprovalId) -> Result<ApprovalStatus>;
}

pub struct InMemoryApprovalGate<S: EventStore> {
    store: Arc<S>,
    pending: Mutex<HashMap<ApprovalId, ApprovalStatus>>,
}

impl<S: EventStore> InMemoryApprovalGate<S> {
    pub fn new(store: Arc<S>) -> Self {
        Self {
            store,
            pending: Mutex::new(HashMap::new()),
        }
    }

    /// Record an externally-resolved approval's terminal state without
    /// writing an event. Used by the `InboxPermissionHandler` so that
    /// `gate.status(id)` stays truthful after a resolve that bypassed
    /// `gate.grant`/`gate.deny` (the inbox handler is the production
    /// source of truth; the gate keeps the trait surface other crates
    /// hold an `Arc<dyn ApprovalGate>` against). Idempotent — overwriting
    /// `Granted` with `Denied` would only happen if an external writer
    /// already produced a contradictory event, which the handler's
    /// single-writer guarantee in `resolve` prevents.
    pub fn record_status(&self, id: ApprovalId, status: ApprovalStatus) {
        self.pending.lock().insert(id, status);
    }

    /// Replay every approval event in the store into the in-memory map.
    /// Without this, `gate.status` returns `Pending` after a process
    /// restart for approvals that were granted/denied in an earlier
    /// session. Called from `AppCore::boot`.
    pub async fn replay_from_store(&self) -> Result<()> {
        let events = self.store.read_all(StreamOptions::default()).await?;
        let mut pending = self.pending.lock();
        pending.clear();
        for env in &events {
            match &env.payload {
                EventPayload::ApprovalRequested { approval_id, .. } => {
                    pending.insert(*approval_id, ApprovalStatus::Pending);
                }
                EventPayload::ApprovalGranted { approval_id } => {
                    pending.insert(*approval_id, ApprovalStatus::Granted);
                }
                EventPayload::ApprovalDenied { approval_id, .. } => {
                    pending.insert(*approval_id, ApprovalStatus::Denied);
                }
                _ => {}
            }
        }
        Ok(())
    }
}

#[async_trait]
impl<S: EventStore + 'static> ApprovalGate for InMemoryApprovalGate<S> {
    async fn request(&self, req: ApprovalRequest, actor: Actor) -> Result<EventEnvelope> {
        self.pending.lock().insert(req.id, ApprovalStatus::Pending);
        self.store
            .append(
                StreamId::Workspace(req.workspace_id),
                None,
                actor,
                EventPayload::ApprovalRequested {
                    approval_id: req.id,
                    workspace_id: req.workspace_id,
                    gate: req.gate,
                    summary: req.summary,
                },
            )
            .await
    }

    async fn grant(&self, id: ApprovalId, actor: Actor) -> Result<EventEnvelope> {
        self.pending.lock().insert(id, ApprovalStatus::Granted);
        self.store
            .append(
                StreamId::System,
                None,
                actor,
                EventPayload::ApprovalGranted { approval_id: id },
            )
            .await
    }

    async fn deny(
        &self,
        id: ApprovalId,
        reason: Option<String>,
        actor: Actor,
    ) -> Result<EventEnvelope> {
        self.pending.lock().insert(id, ApprovalStatus::Denied);
        self.store
            .append(
                StreamId::System,
                None,
                actor,
                EventPayload::ApprovalDenied {
                    approval_id: id,
                    reason,
                },
            )
            .await
    }

    async fn status(&self, id: ApprovalId) -> Result<ApprovalStatus> {
        Ok(self
            .pending
            .lock()
            .get(&id)
            .copied()
            .unwrap_or(ApprovalStatus::Pending))
    }
}
