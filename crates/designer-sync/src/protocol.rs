//! Sync protocol messages. A session is short-lived: hello → pull → ack.

use crate::clock::{NodeId, VectorClock};
use crate::format::{SyncEvent, SyncFormat};
use crate::SyncResult;
use designer_core::EventEnvelope;
use serde::{Deserialize, Serialize};

pub const HANDSHAKE_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncMessage {
    Hello {
        version: u32,
        node: NodeId,
    },
    Welcome {
        version: u32,
        node: NodeId,
        clock: VectorClock,
    },
    Pull {
        since: VectorClock,
        max: u32,
    },
    PullResponse {
        events: Vec<SyncEvent>,
        clock: VectorClock,
    },
    Push {
        events: Vec<SyncEvent>,
    },
    Ack {
        accepted: u64,
    },
    Bye,
}

/// State machine driving one sync exchange.
pub struct SyncSession {
    pub local: NodeId,
    pub remote: Option<NodeId>,
    pub local_clock: VectorClock,
    pub remote_clock: VectorClock,
}

impl SyncSession {
    pub fn new(local: NodeId, local_clock: VectorClock) -> Self {
        Self {
            local,
            remote: None,
            local_clock,
            remote_clock: VectorClock::new(),
        }
    }

    pub fn hello(&self) -> SyncMessage {
        SyncMessage::Hello {
            version: HANDSHAKE_VERSION,
            node: self.local,
        }
    }

    pub fn handle(&mut self, msg: SyncMessage) -> SyncResult<Option<SyncMessage>> {
        match msg {
            SyncMessage::Hello { version, node } => {
                if version != HANDSHAKE_VERSION {
                    return Err(crate::SyncError::VersionMismatch(
                        version,
                        HANDSHAKE_VERSION,
                    ));
                }
                self.remote = Some(node);
                Ok(Some(SyncMessage::Welcome {
                    version: HANDSHAKE_VERSION,
                    node: self.local,
                    clock: self.local_clock.clone(),
                }))
            }
            SyncMessage::Welcome {
                version,
                node,
                clock,
            } => {
                if version != HANDSHAKE_VERSION {
                    return Err(crate::SyncError::VersionMismatch(
                        version,
                        HANDSHAKE_VERSION,
                    ));
                }
                self.remote = Some(node);
                self.remote_clock = clock;
                // Caller drives Pull.
                Ok(None)
            }
            SyncMessage::Pull { since, max: _ } => {
                // Caller assembles the event slice above the given clock; we
                // return the shape for it to populate.
                self.remote_clock = since;
                Ok(None)
            }
            SyncMessage::PullResponse { events, clock } => {
                self.remote_clock = clock;
                for ev in &events {
                    self.local_clock.observe(ev.origin, ev.origin_sequence);
                }
                Ok(Some(SyncMessage::Ack {
                    accepted: events.len() as u64,
                }))
            }
            SyncMessage::Push { events } => {
                for ev in &events {
                    self.local_clock.observe(ev.origin, ev.origin_sequence);
                }
                Ok(Some(SyncMessage::Ack {
                    accepted: events.len() as u64,
                }))
            }
            SyncMessage::Ack { .. } => Ok(None),
            SyncMessage::Bye => Ok(None),
        }
    }
}

/// Convenience: wrap a slice of envelopes into SyncEvents for a given origin.
#[allow(dead_code)]
pub fn wrap(events: Vec<EventEnvelope>, origin: NodeId) -> Vec<SyncEvent> {
    events
        .into_iter()
        .enumerate()
        .map(|(i, envelope)| SyncEvent {
            origin,
            origin_sequence: (i + 1) as u64,
            envelope,
        })
        .collect()
}

/// Build a SyncFormat bundle for transmission.
#[allow(dead_code)]
pub fn bundle(origin: NodeId, clock: VectorClock, events: Vec<SyncEvent>) -> SyncFormat {
    SyncFormat {
        version: crate::format::SYNC_FORMAT_VERSION,
        node: origin,
        clock,
        events,
    }
}
