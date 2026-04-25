//! Designer core — domain types, event store, projections.
//!
//! Event-sourced architecture: every state change is an append-only event.
//! Projections derive aggregate state by replaying events. The core is
//! runtime-agnostic (no Claude, no Swift); consumers plug in orchestrators
//! and helpers via traits.

pub mod domain;
pub mod error;
pub mod event;
pub mod ids;
pub mod projection;
pub mod store;
pub mod time;

pub use domain::{
    Actor, Artifact, ArtifactKind, Autonomy, PayloadRef, Project, Tab, TabTemplate, Track,
    TrackState, Workspace, WorkspaceState,
};
pub use error::{CoreError, Result};
pub use event::{Event, EventEnvelope, EventKind, EventPayload};
pub use ids::{
    AgentId, ApprovalId, ArtifactId, EventId, ProjectId, StreamId, TabId, TaskId, TrackId,
    WorkspaceId,
};
pub use projection::{Projection, ProjectionError, Projector};
pub use store::{EventStore, SqliteEventStore, StreamOptions};
pub use time::{monotonic_now, rfc3339, Timestamp};
