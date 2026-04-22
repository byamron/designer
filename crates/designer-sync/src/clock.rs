//! Causality primitives. Each participant has a `NodeId` (UUIDv7). A
//! `VectorClock` records the highest-seen sequence per node; we use it to
//! detect concurrent edits and ensure we never drop or re-order events on
//! replay.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fmt;
use uuid::Uuid;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
pub struct NodeId(pub Uuid);

impl NodeId {
    pub fn new() -> Self {
        Self(Uuid::now_v7())
    }
}

impl Default for NodeId {
    fn default() -> Self {
        Self::new()
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "node_{}", self.0)
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct VectorClock {
    pub counters: BTreeMap<NodeId, u64>,
}

impl VectorClock {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn observe(&mut self, node: NodeId, seq: u64) {
        let entry = self.counters.entry(node).or_insert(0);
        if seq > *entry {
            *entry = seq;
        }
    }

    pub fn contains(&self, node: NodeId, seq: u64) -> bool {
        self.counters.get(&node).copied().unwrap_or(0) >= seq
    }

    /// Returns true if `self` dominates or equals `other` (i.e., has seen
    /// everything the other has).
    pub fn dominates(&self, other: &VectorClock) -> bool {
        other
            .counters
            .iter()
            .all(|(node, seq)| self.contains(*node, *seq))
    }

    /// Concurrent = neither clock dominates the other.
    pub fn concurrent_with(&self, other: &VectorClock) -> bool {
        !self.dominates(other) && !other.dominates(self)
    }

    pub fn merge(&mut self, other: &VectorClock) {
        for (node, seq) in &other.counters {
            self.observe(*node, *seq);
        }
    }
}
