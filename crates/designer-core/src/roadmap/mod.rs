//! Roadmap canvas (Phase 22.A) — a structural model of `core-docs/roadmap.md`
//! with stable HTML-comment anchors, derived projections (`node_to_claimants`,
//! `claimants_to_node`, `node_to_shipments`), and a status precedence rule
//! that gates `Done` on a recorded shipment.
//!
//! The parser is a streaming walk over `pulldown-cmark` Heading + Html events.
//! No markdown AST is allocated — bodies are byte slices owned by the source
//! string, sliced lazily on expansion.
//!
//! # Layering
//!
//! - [`parser`] turns a `roadmap.md` source into a [`RoadmapTree`] +
//!   [`Vec<NodeIdAssignment>`] (anchor-injection plan).
//! - [`anchors`] applies the assignment by atomically rewriting the file.
//! - [`derive`] is a pure function: `(claims_with_track_state, shipments,
//!   authored) -> NodeStatus`. The Done-gate lives here so call sites can
//!   reason about it in isolation.
//! - [`tree`] holds the structural cache and the three projection views.

mod anchors;
mod derive;
mod parser;
mod tree;

pub use anchors::{write_back_missing_anchors, AnchorWriteOutcome};
pub use derive::derive_node_status;
pub use parser::{parse_roadmap, ParseError};
pub use tree::{NodeIdAssignment, RoadmapHash, RoadmapTree};

use crate::domain::TrackState;
use crate::ids::{TrackId, WorkspaceId};
use crate::time::Timestamp;
use serde::{Deserialize, Serialize};
use std::fmt;
use std::str::FromStr;

/// A roadmap node id is the dotted path encoded in the HTML-comment anchor
/// (e.g. `payments.refunds.api`). Stable across edits — when a user moves the
/// anchor comment with the line, the id travels too.
///
/// Stored as a `String` rather than a Uuid because authors choose the id
/// (it must be human-readable for the markdown anchor) and re-encoding to
/// Uuid would forfeit that.
#[derive(Debug, Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(transparent)]
pub struct NodeId(pub String);

impl NodeId {
    pub fn new(s: impl Into<String>) -> Self {
        Self(s.into())
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl fmt::Display for NodeId {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}

impl FromStr for NodeId {
    type Err = std::convert::Infallible;
    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        Ok(Self(s.to_string()))
    }
}

/// One node in the roadmap tree.
///
/// `body_offset`/`body_length` are byte offsets into the source string
/// captured by the parser. The frontend slices the body lazily when a node
/// expands (and a Web Worker renders the markdown off-main-thread).
///
/// `shipped_at` / `shipped_pr` are reserved for Phase 22.I (shipping
/// history). Phase 22.A keeps the fields additively but never populates them
/// — projections in this PR only fill `status`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RoadmapNode {
    pub id: NodeId,
    pub parent_id: Option<NodeId>,
    pub depth: u8,
    pub headline: String,
    pub body_offset: usize,
    pub body_length: usize,
    pub child_ids: Vec<NodeId>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub external_source: Option<ExternalSource>,
    pub status: NodeStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shipped_at: Option<Timestamp>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shipped_pr: Option<PrRef>,
}

/// Node status set. The order is load-bearing: [`derive_node_status`] takes
/// the max across multi-claim, gated by all-must-ship for `Done`.
///
/// `Backlog < Todo < InProgress < InReview < Done < Canceled`. `Blocked` is
/// a sidecar status — it overrides any non-terminal lifecycle status when
/// present (an explicitly blocked node is blocked, regardless of in-flight
/// claims). `Canceled` is terminal.
#[derive(
    Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, Default,
)]
#[serde(rename_all = "kebab-case")]
pub enum NodeStatus {
    #[default]
    Backlog,
    Todo,
    InProgress,
    InReview,
    Done,
    Canceled,
    Blocked,
}

impl NodeStatus {
    /// Numeric order for the multi-claim max rule. `Blocked` returns the
    /// rank of its replaced status conceptually, but the derive function
    /// handles `Blocked` separately as an override — the rank here is only
    /// used for the lifecycle ladder.
    pub(crate) fn rank(self) -> u8 {
        match self {
            NodeStatus::Backlog => 0,
            NodeStatus::Todo => 1,
            NodeStatus::InProgress => 2,
            NodeStatus::InReview => 3,
            NodeStatus::Done => 4,
            NodeStatus::Canceled => 5,
            NodeStatus::Blocked => 6,
        }
    }
}

/// One workspace/track claim against a node.
///
/// `team_id` is intentionally absent from this struct — the data model
/// passed in the brief did not include one and Designer has no `Team`
/// projection in 22.A scope. Tie-breaks for stable multi-claim ordering
/// fall back to `track_id` lexicographic, which is sufficient for
/// determinism on event-replay (UUIDv7 ids encode creation time so the
/// secondary sort agrees with the primary `claimed_at` sort in practice).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeClaim {
    pub node_id: NodeId,
    pub workspace_id: WorkspaceId,
    pub track_id: TrackId,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub subagent_role: Option<String>,
    pub claimed_at: Timestamp,
}

/// A track that shipped against a node. Append-only — Phase 22.I owns the
/// emission path; Phase 22.A only defines the shape so the projection is
/// stable when 22.I lands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct NodeShipment {
    pub node_id: NodeId,
    pub workspace_id: WorkspaceId,
    pub track_id: TrackId,
    pub pr_url: String,
    pub shipped_at: Timestamp,
}

/// External source pointer — currently unused by 22.A but reserved on the
/// node for future "linked to Linear ticket" / "linked to GitHub issue"
/// rendering. Kept additive so it can be populated later without schema
/// churn.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum ExternalSource {
    Linear { issue_id: String },
    GitHub { repo: String, number: u64 },
    Url { href: String },
}

/// PR reference attached to a shipment.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PrRef {
    pub url: String,
    pub number: Option<u64>,
}

/// A claim plus the lifecycle state of its owning track. The pure
/// [`derive_node_status`] function takes a slice of these — keeping
/// the function signature complete (claim presence + lifecycle state)
/// avoids the bug where multi-claim derivation looked at claims alone
/// and projected `InProgress` even when every claim had merged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ClaimWithTrackState {
    pub claim: NodeClaim,
    pub track_state: TrackState,
}
