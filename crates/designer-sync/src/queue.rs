//! Offline queue. Outbound sync messages land here when the peer is
//! unreachable; on reconnect the queue drains in order.

use crate::protocol::SyncMessage;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use time::OffsetDateTime;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QueuedMessage {
    pub enqueued_at: OffsetDateTime,
    pub message: SyncMessage,
}

#[derive(Debug, Default)]
pub struct OfflineQueue {
    inner: VecDeque<QueuedMessage>,
}

impl OfflineQueue {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, message: SyncMessage) {
        self.inner.push_back(QueuedMessage {
            enqueued_at: OffsetDateTime::now_utc(),
            message,
        });
    }

    pub fn drain(&mut self) -> Vec<QueuedMessage> {
        self.inner.drain(..).collect()
    }

    pub fn len(&self) -> usize {
        self.inner.len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.is_empty()
    }
}
