//! Pure status derivation. Isolated from the projection so the multi-claim
//! precedence rule + Done-gate can be tested in one place.
//!
//! # Rules (per `core-docs/roadmap.md` §22.A)
//!
//! 1. **Authored status** is the floor for unclaimed nodes — except authored
//!    `Done` without a recorded shipment falls back to `InReview` (the
//!    Done = shipped invariant overrides authored status to keep the
//!    rendering honest).
//! 2. **Track lifecycle → NodeStatus** for claimed nodes:
//!    - `Active` → `InProgress`
//!    - `RequestingMerge` / `PrOpen` → `InReview`
//!    - `Merged` (with shipment) → `Done`
//!    - `Merged` (no shipment yet) → `InReview` (transient)
//!    - `Archived` → `Canceled` (without merge) or unchanged (with merge)
//! 3. **Multi-claim**: max-rank across claiming tracks, **except** `Done`
//!    requires every claim to have a recorded shipment ("all-must-ship"
//!    Done gate). If any claim is unshipped, the node projects `InReview`.
//! 4. **`Blocked`** authored status is preserved as an override unless the
//!    node has actually entered `Done` via shipment evidence — a node that
//!    actually shipped is no longer blocked.

use super::{ClaimWithTrackState, NodeShipment, NodeStatus};
use crate::domain::TrackState;

/// Derive the projected `NodeStatus` for a single node from its claims +
/// shipments + authored fallback.
pub fn derive_node_status(
    claims_with_state: &[ClaimWithTrackState],
    shipments: &[NodeShipment],
    authored: NodeStatus,
) -> NodeStatus {
    // No claims → fall back to authored, with the Done-gate override.
    if claims_with_state.is_empty() {
        if matches!(authored, NodeStatus::Done) && shipments.is_empty() {
            return NodeStatus::InReview;
        }
        return authored;
    }

    // Per-claim lifecycle status.
    let claim_statuses: Vec<NodeStatus> = claims_with_state
        .iter()
        .map(|c| track_state_to_node_status(&c.claim, c.track_state, shipments))
        .collect();

    // All-must-ship Done gate: only emit Done if every claim has a shipment.
    let any_unshipped = claims_with_state
        .iter()
        .any(|c| !shipment_for(&c.claim, shipments));
    let max_status = claim_statuses
        .iter()
        .copied()
        .max_by_key(|s| s.rank())
        .unwrap_or(authored);

    let projected = match max_status {
        NodeStatus::Done if any_unshipped => NodeStatus::InReview,
        other => other,
    };

    // `Blocked` authored override beats everything except an actually-shipped
    // (multi-claim all-shipped) Done.
    if matches!(authored, NodeStatus::Blocked) && !matches!(projected, NodeStatus::Done) {
        return NodeStatus::Blocked;
    }

    projected
}

fn track_state_to_node_status(
    claim: &super::NodeClaim,
    state: TrackState,
    shipments: &[NodeShipment],
) -> NodeStatus {
    match state {
        TrackState::Active => NodeStatus::InProgress,
        TrackState::RequestingMerge | TrackState::PrOpen => NodeStatus::InReview,
        TrackState::Merged => {
            if shipment_for(claim, shipments) {
                NodeStatus::Done
            } else {
                NodeStatus::InReview
            }
        }
        TrackState::Archived => {
            if shipment_for(claim, shipments) {
                NodeStatus::Done
            } else {
                NodeStatus::Canceled
            }
        }
    }
}

fn shipment_for(claim: &super::NodeClaim, shipments: &[NodeShipment]) -> bool {
    shipments
        .iter()
        .any(|s| s.node_id == claim.node_id && s.track_id == claim.track_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ids::{TrackId, WorkspaceId};
    use crate::roadmap::{NodeClaim, NodeId, NodeShipment};
    use crate::time::Timestamp;

    fn ts() -> Timestamp {
        crate::time::parse_rfc3339("2026-05-03T12:00:00Z").unwrap()
    }

    fn claim(node: &str, track: TrackId) -> NodeClaim {
        NodeClaim {
            node_id: NodeId::new(node),
            workspace_id: WorkspaceId::new(),
            track_id: track,
            subagent_role: None,
            claimed_at: ts(),
        }
    }

    fn shipment(node: &str, track: TrackId) -> NodeShipment {
        NodeShipment {
            node_id: NodeId::new(node),
            workspace_id: WorkspaceId::new(),
            track_id: track,
            pr_url: "https://example/pr/1".into(),
            shipped_at: ts(),
        }
    }

    #[test]
    fn unclaimed_returns_authored() {
        assert_eq!(
            derive_node_status(&[], &[], NodeStatus::Backlog),
            NodeStatus::Backlog
        );
        assert_eq!(
            derive_node_status(&[], &[], NodeStatus::InProgress),
            NodeStatus::InProgress
        );
    }

    #[test]
    fn authored_done_without_shipment_demotes_to_in_review() {
        assert_eq!(
            derive_node_status(&[], &[], NodeStatus::Done),
            NodeStatus::InReview
        );
    }

    #[test]
    fn single_claim_active_projects_in_progress() {
        let t = TrackId::new();
        let claims = vec![ClaimWithTrackState {
            claim: claim("n", t),
            track_state: TrackState::Active,
        }];
        assert_eq!(
            derive_node_status(&claims, &[], NodeStatus::Backlog),
            NodeStatus::InProgress
        );
    }

    #[test]
    fn merged_with_shipment_projects_done() {
        let t = TrackId::new();
        let claims = vec![ClaimWithTrackState {
            claim: claim("n", t),
            track_state: TrackState::Merged,
        }];
        let ships = vec![shipment("n", t)];
        assert_eq!(
            derive_node_status(&claims, &ships, NodeStatus::Backlog),
            NodeStatus::Done
        );
    }

    #[test]
    fn merged_without_shipment_projects_in_review() {
        let t = TrackId::new();
        let claims = vec![ClaimWithTrackState {
            claim: claim("n", t),
            track_state: TrackState::Merged,
        }];
        assert_eq!(
            derive_node_status(&claims, &[], NodeStatus::Backlog),
            NodeStatus::InReview
        );
    }

    #[test]
    fn multi_claim_all_must_ship_for_done() {
        let t1 = TrackId::new();
        let t2 = TrackId::new();
        let claims = vec![
            ClaimWithTrackState {
                claim: claim("n", t1),
                track_state: TrackState::Merged,
            },
            ClaimWithTrackState {
                claim: claim("n", t2),
                track_state: TrackState::Merged,
            },
        ];
        // Only one ship → InReview.
        let ships = vec![shipment("n", t1)];
        assert_eq!(
            derive_node_status(&claims, &ships, NodeStatus::Backlog),
            NodeStatus::InReview
        );
        // Both ship → Done.
        let ships = vec![shipment("n", t1), shipment("n", t2)];
        assert_eq!(
            derive_node_status(&claims, &ships, NodeStatus::Backlog),
            NodeStatus::Done
        );
    }

    #[test]
    fn multi_claim_takes_max_rank() {
        let t1 = TrackId::new();
        let t2 = TrackId::new();
        let claims = vec![
            ClaimWithTrackState {
                claim: claim("n", t1),
                track_state: TrackState::Active, // -> InProgress
            },
            ClaimWithTrackState {
                claim: claim("n", t2),
                track_state: TrackState::PrOpen, // -> InReview (higher)
            },
        ];
        assert_eq!(
            derive_node_status(&claims, &[], NodeStatus::Backlog),
            NodeStatus::InReview
        );
    }

    #[test]
    fn archived_without_merge_projects_canceled() {
        let t = TrackId::new();
        let claims = vec![ClaimWithTrackState {
            claim: claim("n", t),
            track_state: TrackState::Archived,
        }];
        assert_eq!(
            derive_node_status(&claims, &[], NodeStatus::Backlog),
            NodeStatus::Canceled
        );
    }

    #[test]
    fn blocked_authored_overrides_unless_actually_shipped() {
        let t = TrackId::new();
        let active_claim = vec![ClaimWithTrackState {
            claim: claim("n", t),
            track_state: TrackState::Active,
        }];
        assert_eq!(
            derive_node_status(&active_claim, &[], NodeStatus::Blocked),
            NodeStatus::Blocked
        );

        let merged_with_ship = vec![ClaimWithTrackState {
            claim: claim("n", t),
            track_state: TrackState::Merged,
        }];
        let ships = vec![shipment("n", t)];
        // Actually shipped → Blocked override is dropped, Done stands.
        assert_eq!(
            derive_node_status(&merged_with_ship, &ships, NodeStatus::Blocked),
            NodeStatus::Done
        );
    }

    /// Spec scenario: parallel work where one track has shipped and one
    /// is still active. The all-must-ship Done gate must demote to
    /// InReview even though the max-rank across claims is Done.
    #[test]
    fn multi_claim_mixed_active_and_merged_with_ship_projects_in_review() {
        let t1 = TrackId::new();
        let t2 = TrackId::new();
        let claims = vec![
            ClaimWithTrackState {
                claim: claim("n", t1),
                track_state: TrackState::Active,
            },
            ClaimWithTrackState {
                claim: claim("n", t2),
                track_state: TrackState::Merged,
            },
        ];
        let ships = vec![shipment("n", t2)];
        assert_eq!(
            derive_node_status(&claims, &ships, NodeStatus::Backlog),
            NodeStatus::InReview,
            "one unshipped claim demotes the node to InReview even when the merged claim shipped"
        );
    }

    #[test]
    fn order_of_claims_does_not_affect_result() {
        let t1 = TrackId::new();
        let t2 = TrackId::new();
        let a = ClaimWithTrackState {
            claim: claim("n", t1),
            track_state: TrackState::Active,
        };
        let b = ClaimWithTrackState {
            claim: claim("n", t2),
            track_state: TrackState::Merged,
        };
        let ships = vec![shipment("n", t2)];
        // [a, b] vs [b, a] — derive is order-independent (max-rank).
        let s1 = derive_node_status(&[a.clone(), b.clone()], &ships, NodeStatus::Backlog);
        let s2 = derive_node_status(&[b, a], &ships, NodeStatus::Backlog);
        assert_eq!(s1, s2);
        // One claim merged-and-shipped, one still active → not all shipped → InReview.
        assert_eq!(s1, NodeStatus::InReview);
    }
}
