//! Sync protocol for Designer. Mobile-ready from day one — the desktop + mobile
//! clients sync the same event stream bidirectionally without a central
//! server. Pairing is user-driven (QR or 6-digit code); transports are
//! pluggable so we can add a tunneled relay later without changing the wire
//! format.
//!
//! Phase-7 goals (from roadmap):
//!
//! * Stable serialization for events (`SyncFormat` versioned).
//! * Causality via `(node_id, sequence)` plus a lightweight vector clock for
//!   conflict visibility.
//! * Peer-to-peer sync definition — handshake, pull, push, ack.
//! * Pairing primitives — no cloud auth.
//! * Offline queue + replay.

mod clock;
mod format;
mod pairing;
mod protocol;
mod queue;

pub use clock::{NodeId, VectorClock};
pub use format::{SyncEvent, SyncFormat};
pub use pairing::{PairingCode, PairingMaterial};
pub use protocol::{SyncMessage, SyncSession, HANDSHAKE_VERSION};
pub use queue::{OfflineQueue, QueuedMessage};

use thiserror::Error;

#[derive(Debug, Error)]
pub enum SyncError {
    #[error("version mismatch: got {0}, expected {1}")]
    VersionMismatch(u32, u32),
    #[error("handshake failed: {0}")]
    Handshake(String),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("core: {0}")]
    Core(#[from] designer_core::CoreError),
}

pub type SyncResult<T> = Result<T, SyncError>;
