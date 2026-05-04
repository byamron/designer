//! Designer core — domain types, event store, projections.
//!
//! Event-sourced architecture: every state change is an append-only event.
//! Projections derive aggregate state by replaying events. The core is
//! runtime-agnostic (no Claude, no Swift); consumers plug in orchestrators
//! and helpers via traits.

pub mod anchor;
pub mod domain;
pub mod error;
pub mod event;
pub mod finding;
pub mod ids;
pub mod projection;
pub mod proposal;
pub mod roadmap;
pub mod store;
pub mod time;

pub use anchor::Anchor;
pub use domain::{
    author_roles, Actor, Artifact, ArtifactKind, Autonomy, PayloadRef, Project, Tab, TabTemplate,
    Track, TrackState, Workspace, WorkspaceState,
};
pub use error::{CoreError, Result};
pub use event::{Event, EventEnvelope, EventKind, EventPayload, FrictionFileError, ScreenshotRef};
pub use finding::{Finding, Severity, ThumbSignal};
pub use ids::{
    AgentId, ApprovalId, ArtifactId, EventId, FindingId, FrictionId, ProjectId, ProposalId,
    StreamId, TabId, TaskId, TrackId, WorkspaceId,
};
pub use projection::{
    artifact_belongs_in_spine, Projection, ProjectionError, Projector, SPINE_ARTIFACT_KINDS,
    SPINE_AUTHOR_ROLES,
};
pub use proposal::{Proposal, ProposalKind, ProposalResolution, ProposalStatus};
pub use store::{EventStore, SqliteEventStore, StreamOptions};
pub use time::{monotonic_now, rfc3339, Timestamp};
