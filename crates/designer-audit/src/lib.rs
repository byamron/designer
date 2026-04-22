//! Append-only audit log. Wraps the core event store and adds convenience
//! writers for audit-category entries plus structured query helpers. The
//! underlying events live in the same SQLite log, so we never split truth
//! across two stores.

use async_trait::async_trait;
use designer_core::{
    Actor, CoreError, EventEnvelope, EventPayload, EventStore, Result, StreamId, StreamOptions,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AuditEntry {
    pub category: String,
    pub summary: String,
    pub details: Value,
}

#[async_trait]
pub trait AuditLog: Send + Sync {
    async fn record(&self, actor: Actor, entry: AuditEntry) -> Result<EventEnvelope>;
    async fn list(&self, limit: u64) -> Result<Vec<EventEnvelope>>;
}

pub struct SqliteAuditLog<S: EventStore> {
    store: Arc<S>,
}

impl<S: EventStore> SqliteAuditLog<S> {
    pub fn new(store: Arc<S>) -> Self {
        Self { store }
    }
}

#[async_trait]
impl<S: EventStore + 'static> AuditLog for SqliteAuditLog<S> {
    async fn record(&self, actor: Actor, entry: AuditEntry) -> Result<EventEnvelope> {
        let payload = EventPayload::AuditEntry {
            category: entry.category,
            summary: entry.summary,
            details: entry.details,
        };
        self.store
            .append(StreamId::System, None, actor, payload)
            .await
    }

    async fn list(&self, limit: u64) -> Result<Vec<EventEnvelope>> {
        let opts = StreamOptions {
            limit: Some(limit),
            ..Default::default()
        };
        let mut events = self.store.read_all(opts).await?;
        events.retain(|e| matches!(e.payload, EventPayload::AuditEntry { .. }));
        Ok(events)
    }
}

/// Convenience: produce an `AuditEntry` from category + summary + serializable details.
pub fn entry(
    category: impl Into<String>,
    summary: impl Into<String>,
    details: impl Serialize,
) -> std::result::Result<AuditEntry, CoreError> {
    Ok(AuditEntry {
        category: category.into(),
        summary: summary.into(),
        details: serde_json::to_value(details)?,
    })
}
