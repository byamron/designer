//! Cost tracking. Every `CostRecorded` event updates per-workspace usage; a
//! configured `CostCap` returns `CostCapExceeded` before additional cost events
//! are appended. The cap check is a read-before-write — consumers must consult
//! `check_and_record`, not record directly, when enforcing.

use crate::SafetyError;
use dashmap::DashMap;
use designer_core::{Actor, EventEnvelope, EventPayload, EventStore, StreamId, WorkspaceId};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct CostUsage {
    pub tokens_input: u64,
    pub tokens_output: u64,
    pub dollars_cents: u64,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize)]
pub struct CostCap {
    pub max_dollars_cents: Option<u64>,
    pub max_tokens: Option<u64>,
}

impl CostCap {
    pub fn allows(&self, projected: CostUsage) -> bool {
        if let Some(max) = self.max_dollars_cents {
            if projected.dollars_cents > max {
                return false;
            }
        }
        if let Some(max) = self.max_tokens {
            if projected.tokens_input + projected.tokens_output > max {
                return false;
            }
        }
        true
    }
}

pub struct CostTracker<S: EventStore> {
    store: Arc<S>,
    usage: Arc<DashMap<WorkspaceId, CostUsage>>,
    caps: Arc<DashMap<WorkspaceId, CostCap>>,
    default_cap: CostCap,
}

impl<S: EventStore> Clone for CostTracker<S> {
    fn clone(&self) -> Self {
        Self {
            store: self.store.clone(),
            usage: self.usage.clone(),
            caps: self.caps.clone(),
            default_cap: self.default_cap,
        }
    }
}

impl<S: EventStore> CostTracker<S> {
    pub fn new(store: Arc<S>, default_cap: CostCap) -> Self {
        Self {
            store,
            usage: Arc::new(DashMap::new()),
            caps: Arc::new(DashMap::new()),
            default_cap,
        }
    }

    pub fn usage(&self, workspace_id: WorkspaceId) -> CostUsage {
        self.usage
            .get(&workspace_id)
            .map(|u| *u)
            .unwrap_or_default()
    }

    pub fn set_cap(&self, workspace_id: WorkspaceId, cap: CostCap) {
        self.caps.insert(workspace_id, cap);
    }

    pub fn cap_for(&self, workspace_id: WorkspaceId) -> CostCap {
        self.caps
            .get(&workspace_id)
            .map(|c| *c)
            .unwrap_or(self.default_cap)
    }

    /// Read-before-write: project new total, check cap, then append + update.
    pub async fn check_and_record(
        &self,
        workspace_id: WorkspaceId,
        delta: CostUsage,
        actor: Actor,
    ) -> std::result::Result<EventEnvelope, SafetyError> {
        let current = self.usage(workspace_id);
        let projected = CostUsage {
            tokens_input: current.tokens_input + delta.tokens_input,
            tokens_output: current.tokens_output + delta.tokens_output,
            dollars_cents: current.dollars_cents + delta.dollars_cents,
        };
        let cap = self.cap_for(workspace_id);
        if !cap.allows(projected) {
            return Err(SafetyError::CostCapExceeded(format!(
                "workspace {}: projected {:?} exceeds cap {:?}",
                workspace_id, projected, cap
            )));
        }

        let env = self
            .store
            .append(
                StreamId::Workspace(workspace_id),
                None,
                actor,
                EventPayload::CostRecorded {
                    workspace_id,
                    tokens_input: delta.tokens_input,
                    tokens_output: delta.tokens_output,
                    dollars_cents: delta.dollars_cents,
                },
            )
            .await
            .map_err(SafetyError::Core)?;

        self.usage.insert(workspace_id, projected);
        Ok(env)
    }
}
