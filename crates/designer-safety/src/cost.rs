//! Cost tracking. Every `CostRecorded` event updates per-workspace usage; a
//! configured `CostCap` returns `CostCapExceeded` before additional cost events
//! are appended. The cap check is a read-before-write — consumers must consult
//! `check_and_record`, not record directly, when enforcing.

use crate::SafetyError;
use dashmap::DashMap;
use designer_core::{
    Actor, EventEnvelope, EventPayload, EventStore, StreamId, StreamOptions, WorkspaceId,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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

    /// Replay every `CostRecorded` event in the store into the in-memory
    /// usage map. Without this, `usage()` and `cost_status()` return zero
    /// after a process restart even though the historical spend is still in
    /// the event log — the cap check would silently allow a workspace to
    /// double-spend its budget across boots. Called from `AppCore::boot`
    /// right after construction so the first `cost_status` IPC reflects
    /// reality.
    ///
    /// Idempotent: rebuilds the map from scratch on every call. Cheap on
    /// startup (one full read), not intended to be called frequently.
    pub async fn replay_from_store(&self) -> std::result::Result<(), SafetyError> {
        let events = self
            .store
            .read_all(StreamOptions::default())
            .await
            .map_err(SafetyError::Core)?;
        // Fold every CostRecorded into a local map first, then publish in one
        // pass. The previous implementation called `self.usage.entry(...)` per
        // event, locking a DashMap shard each time; for long event histories
        // that is N shard-acquisitions when 1 would suffice. Equivalence with
        // the old per-event path is asserted in `tests::replay_matches_old_path`.
        let mut acc: HashMap<WorkspaceId, CostUsage> = HashMap::new();
        for env in &events {
            if let EventPayload::CostRecorded {
                workspace_id,
                tokens_input,
                tokens_output,
                dollars_cents,
                ..
            } = &env.payload
            {
                let entry = acc.entry(*workspace_id).or_default();
                entry.tokens_input = entry.tokens_input.saturating_add(*tokens_input);
                entry.tokens_output = entry.tokens_output.saturating_add(*tokens_output);
                entry.dollars_cents = entry.dollars_cents.saturating_add(*dollars_cents);
            }
        }
        self.usage.clear();
        for (workspace_id, usage) in acc {
            self.usage.insert(workspace_id, usage);
        }
        Ok(())
    }

    /// Record observed spend without a cap check. The Claude orchestrator
    /// pushes `total_cost_usd` from every `result/success` line — that money
    /// has already been spent on Anthropic's side, so refusing to log it
    /// would only desynchronize the cap from reality. Use this for observed
    /// telemetry; use [`CostTracker::check_and_record`] for forecasted spend
    /// that should be gated by the cap.
    pub async fn record(
        &self,
        workspace_id: WorkspaceId,
        delta: CostUsage,
        actor: Actor,
    ) -> std::result::Result<EventEnvelope, SafetyError> {
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
                    tab_id: None,
                    turn_id: None,
                },
            )
            .await
            .map_err(SafetyError::Core)?;
        let mut entry = self.usage.entry(workspace_id).or_default();
        entry.tokens_input = entry.tokens_input.saturating_add(delta.tokens_input);
        entry.tokens_output = entry.tokens_output.saturating_add(delta.tokens_output);
        entry.dollars_cents = entry.dollars_cents.saturating_add(delta.dollars_cents);
        Ok(env)
    }

    /// Read-before-write: project new total, check cap, then delegate to
    /// [`CostTracker::record`]. Use this for forecasted spend (an action
    /// about to incur cost); use `record` directly for observed telemetry.
    pub async fn check_and_record(
        &self,
        workspace_id: WorkspaceId,
        delta: CostUsage,
        actor: Actor,
    ) -> std::result::Result<EventEnvelope, SafetyError> {
        let current = self.usage(workspace_id);
        let projected = CostUsage {
            tokens_input: current.tokens_input.saturating_add(delta.tokens_input),
            tokens_output: current.tokens_output.saturating_add(delta.tokens_output),
            dollars_cents: current.dollars_cents.saturating_add(delta.dollars_cents),
        };
        let cap = self.cap_for(workspace_id);
        if !cap.allows(projected) {
            return Err(SafetyError::CostCapExceeded(format!(
                "workspace {}: projected {:?} exceeds cap {:?}",
                workspace_id, projected, cap
            )));
        }
        self.record(workspace_id, delta, actor).await
    }
}

/// Convert observed dollars into cents, rounding to nearest. Non-finite or
/// negative values clamp to zero — the alternative (`as u64` saturation on
/// negatives) would wrap to `u64::MAX`. The caller decides whether a clamp
/// warrants a log line; this helper is silent.
pub fn usd_to_cents(usd: f64) -> u64 {
    if !usd.is_finite() || usd <= 0.0 {
        return 0;
    }
    (usd * 100.0).round() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use designer_core::SqliteEventStore;

    /// Reference implementation of the previous per-event replay path. Used
    /// only in the equivalence test below so the new bulk implementation can
    /// be compared against the exact code it replaced.
    async fn old_path_replay(store: &Arc<SqliteEventStore>) -> DashMap<WorkspaceId, CostUsage> {
        let usage: DashMap<WorkspaceId, CostUsage> = DashMap::new();
        let events = store.read_all(StreamOptions::default()).await.unwrap();
        for env in &events {
            if let EventPayload::CostRecorded {
                workspace_id,
                tokens_input,
                tokens_output,
                dollars_cents,
                ..
            } = &env.payload
            {
                let mut entry = usage.entry(*workspace_id).or_default();
                entry.tokens_input = entry.tokens_input.saturating_add(*tokens_input);
                entry.tokens_output = entry.tokens_output.saturating_add(*tokens_output);
                entry.dollars_cents = entry.dollars_cents.saturating_add(*dollars_cents);
            }
        }
        usage
    }

    #[tokio::test]
    async fn replay_matches_old_path() {
        let store = Arc::new(SqliteEventStore::open_in_memory().unwrap());
        // Five workspaces, 20 events apiece — 100 events total. Spread the
        // appends across workspaces so the event stream interleaves them and
        // the accumulator must merge per-workspace contributions correctly.
        let workspaces: Vec<WorkspaceId> = (0..5).map(|_| WorkspaceId::new()).collect();
        for i in 0..100u64 {
            let ws = workspaces[(i as usize) % workspaces.len()];
            store
                .append(
                    StreamId::Workspace(ws),
                    None,
                    Actor::user(),
                    EventPayload::CostRecorded {
                        workspace_id: ws,
                        tokens_input: i,
                        tokens_output: i * 2,
                        dollars_cents: i * 3 + 7,
                        tab_id: None,
                        turn_id: None,
                    },
                )
                .await
                .unwrap();
        }
        // A single non-cost event mixed in to confirm the filter still skips it.
        store
            .append(
                StreamId::Workspace(workspaces[0]),
                None,
                Actor::user(),
                EventPayload::AuditEntry {
                    category: "test".into(),
                    summary: "non-cost event in stream".into(),
                    details: serde_json::Value::Null,
                },
            )
            .await
            .unwrap();

        let tracker = CostTracker::new(store.clone(), CostCap::default());
        tracker.replay_from_store().await.unwrap();

        let expected = old_path_replay(&store).await;
        for ws in &workspaces {
            let got = tracker.usage(*ws);
            let want = expected.get(ws).map(|u| *u).unwrap_or_default();
            assert_eq!(got, want, "workspace {ws} mismatched after replay");
        }
        // Workspaces in the old path that the new path missed (or vice versa)
        // would also be a divergence — guard the inverse direction.
        assert_eq!(
            expected.len(),
            workspaces.len(),
            "fixture should populate every workspace"
        );
    }
}
