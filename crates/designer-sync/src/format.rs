//! Wire format for sync. Thin wrapper over `EventEnvelope` plus causality
//! metadata. Versioned so we can evolve the format without breaking paired
//! clients.

use crate::clock::{NodeId, VectorClock};
use designer_core::EventEnvelope;
use serde::{Deserialize, Serialize};

pub const SYNC_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncFormat {
    pub version: u32,
    pub node: NodeId,
    pub clock: VectorClock,
    pub events: Vec<SyncEvent>,
}

impl SyncFormat {
    pub fn new(node: NodeId) -> Self {
        Self {
            version: SYNC_FORMAT_VERSION,
            node,
            clock: VectorClock::new(),
            events: vec![],
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncEvent {
    pub origin: NodeId,
    pub origin_sequence: u64,
    pub envelope: EventEnvelope,
}
