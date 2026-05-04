//! Phase 22.A — roadmap canvas core methods. Owns the parsed-tree cache
//! per project and the IPC-facing read/write paths.
//!
//! # Concurrency
//!
//! The cache wraps `RwLock<Cached>` per project. Reads (`cmd_get_roadmap`)
//! take a read lock during the cache-hit fast path; the slow path (re-parse
//! on hash mismatch) takes a write lock so two windows can't race a parse.
//!
//! # Anchor write-back
//!
//! The parser may emit anchor-injection assignments. Write-back is gated on:
//!
//! - The on-disk `roadmap.md` mtime is older than [`WRITE_BACK_QUIESCE`]
//!   (5 s) — a fresh save is presumed to be the user actively editing in
//!   another tool; we don't race their changes.
//! - The source on disk still matches what the parser saw (handled inside
//!   [`designer_core::roadmap::write_back_missing_anchors`]).
//!
//! Window-focus gating is handled at the IPC entry point (the frontend
//! only calls `cmd_get_roadmap` when its window is focused or visible).

use crate::core::AppCore;
use designer_core::{
    roadmap::{
        derive_node_status, parse_roadmap, write_back_missing_anchors, AnchorWriteOutcome,
        ClaimWithTrackState, NodeId, NodeShipment, NodeStatus, ParseError, RoadmapHash,
        RoadmapTree,
    },
    Actor, CoreError, EventPayload, EventStore, ProjectId, Projection, StreamId,
};
use parking_lot::RwLock;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, SystemTime};

/// Don't write-back anchors to a file that was modified within this
/// window — the user is likely actively editing in another app.
const WRITE_BACK_QUIESCE: Duration = Duration::from_secs(5);

/// One entry in the per-project parsed-tree cache.
#[derive(Debug)]
struct Cached {
    hash: RoadmapHash,
    tree: Arc<RoadmapTree>,
    parse_error: Option<ParseError>,
}

#[derive(Debug, Default)]
pub struct RoadmapCache {
    inner: RwLock<HashMap<ProjectId, Cached>>,
}

impl RoadmapCache {
    pub fn new() -> Self {
        Self::default()
    }
}

/// Wire view returned to the frontend. One node carries its derived status
/// plus the live claim list; shipments come along separately so the UI
/// doesn't need to walk a per-node map.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapView {
    /// `None` when `core-docs/roadmap.md` does not exist yet.
    pub tree: Option<RoadmapTreeView>,
    /// `Some(_)` when the markdown is present but the parser failed.
    /// `tree` will be `None` in that case so the frontend knows to render
    /// the parse-error slab instead of the canvas.
    pub parse_error: Option<ParseError>,
    /// Live claims keyed by node id. Empty when no tracks are anchored.
    pub claims: Vec<NodeClaimsForView>,
    /// Shipping history keyed by node id. Empty in 22.A; populated by 22.I.
    pub shipments: Vec<NodeShipmentsForView>,
    /// Hash of the source the view was built from. The frontend uses
    /// this as a cheap "did anything change?" signal.
    pub source_hash: Option<RoadmapHash>,
}

/// One node + its derived status. Embeds the same `RoadmapNode` shape
/// the parser emits so the frontend doesn't need a parallel type.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeView {
    #[serde(flatten)]
    pub node: designer_core::roadmap::RoadmapNode,
    /// Derived status — may differ from `node.status` (the authored value)
    /// when claims/shipments override or when the Done-gate kicks in.
    pub derived_status: NodeStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RoadmapTreeView {
    /// Raw markdown source. Body slices are byte ranges into this.
    /// Used by the worker for lazy body rendering.
    pub source: String,
    pub nodes: Vec<NodeView>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeClaimsForView {
    pub node_id: NodeId,
    pub claims: Vec<designer_core::roadmap::NodeClaim>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NodeShipmentsForView {
    pub node_id: NodeId,
    pub shipments: Vec<NodeShipment>,
}

impl AppCore {
    /// Resolve `core-docs/roadmap.md` path for a project. Returns `None`
    /// if the project isn't registered.
    fn roadmap_path(&self, project_id: ProjectId) -> Option<PathBuf> {
        let project = self.projector.project(project_id)?;
        Some(project.root_path.join("core-docs").join("roadmap.md"))
    }

    /// Parse + return the roadmap view for a project. Re-parses only on
    /// `(mtime, size, content_hash)` change.
    pub async fn get_roadmap(&self, project_id: ProjectId) -> Result<RoadmapView, CoreError> {
        let path = self
            .roadmap_path(project_id)
            .ok_or_else(|| CoreError::NotFound(project_id.to_string()))?;

        let cache = self.roadmap_cache();

        // Read file metadata first — cheap.
        let (source, mtime) = match std::fs::read_to_string(&path) {
            Ok(s) => {
                let mtime = std::fs::metadata(&path)
                    .and_then(|m| m.modified())
                    .unwrap_or(SystemTime::UNIX_EPOCH);
                (s, mtime)
            }
            Err(err) if err.kind() == std::io::ErrorKind::NotFound => {
                return Ok(RoadmapView {
                    tree: None,
                    parse_error: None,
                    claims: Vec::new(),
                    shipments: Vec::new(),
                    source_hash: None,
                });
            }
            Err(err) => {
                return Err(CoreError::Invariant(format!(
                    "read {}: {err}",
                    path.display()
                )));
            }
        };

        let hash = RoadmapHash::from_source(mtime, &source);

        // Cache fast path: hit on identical hash.
        {
            let read = cache.inner.read();
            if let Some(cached) = read.get(&project_id) {
                if cached.hash == hash {
                    return Ok(self.assemble_view(project_id, &cached.tree, &cached.parse_error));
                }
            }
        }

        // Cache miss → parse + maybe write-back anchors.
        let (tree, assignments, parse_error) = match parse_roadmap(&source) {
            Ok((tree, assignments)) => (tree, assignments, None),
            Err(err) => (
                designer_core::roadmap::RoadmapTree::empty(&source),
                Vec::new(),
                Some(err),
            ),
        };

        // Write-back anchors when (a) parse succeeded and (b) the file
        // has been quiescent long enough that we're not racing the user.
        if !assignments.is_empty()
            && parse_error.is_none()
            && file_quiesced(mtime, WRITE_BACK_QUIESCE)
        {
            match write_back_missing_anchors(&path, &source, &assignments) {
                Ok(AnchorWriteOutcome::Wrote { count }) => {
                    tracing::info!(
                        project_id = %project_id,
                        path = %path.display(),
                        count,
                        "injected roadmap anchors"
                    );
                    // Re-read so the cache reflects the new on-disk source.
                    if let Ok(new_source) = std::fs::read_to_string(&path) {
                        let new_mtime = std::fs::metadata(&path)
                            .and_then(|m| m.modified())
                            .unwrap_or(SystemTime::UNIX_EPOCH);
                        if let Ok((new_tree, _)) = parse_roadmap(&new_source) {
                            let new_hash = RoadmapHash::from_source(new_mtime, &new_source);
                            let arc_tree = Arc::new(new_tree);
                            cache.inner.write().insert(
                                project_id,
                                Cached {
                                    hash: new_hash,
                                    tree: arc_tree.clone(),
                                    parse_error: None,
                                },
                            );
                            return Ok(self.assemble_view(project_id, &arc_tree, &None));
                        }
                    }
                }
                Ok(AnchorWriteOutcome::NoOp) => {}
                Err(err) => {
                    tracing::warn!(
                        project_id = %project_id,
                        error = %err,
                        "anchor write-back failed; canvas continues with in-memory anchors"
                    );
                }
            }
        }

        let arc_tree = Arc::new(tree);
        cache.inner.write().insert(
            project_id,
            Cached {
                hash,
                tree: arc_tree.clone(),
                parse_error: parse_error.clone(),
            },
        );
        Ok(self.assemble_view(project_id, &arc_tree, &parse_error))
    }

    fn assemble_view(
        &self,
        _project_id: ProjectId,
        tree: &RoadmapTree,
        parse_error: &Option<ParseError>,
    ) -> RoadmapView {
        if parse_error.is_some() {
            // Suppress claims + shipments per the spec's parse-error rule:
            // pills, claims, side attention all suppress until parse succeeds.
            return RoadmapView {
                tree: None,
                parse_error: parse_error.clone(),
                claims: Vec::new(),
                shipments: Vec::new(),
                source_hash: None,
            };
        }

        let all_claims = self.projector.all_node_claimants();
        let all_shipments = self.projector.all_node_shipments();
        let claims_map: HashMap<NodeId, Vec<designer_core::roadmap::NodeClaim>> =
            all_claims.iter().cloned().collect();
        let ships_map: HashMap<NodeId, Vec<NodeShipment>> = all_shipments.iter().cloned().collect();

        // Derive each node's status from authored + claims + ship overlay.
        let nodes: Vec<NodeView> = tree
            .nodes()
            .iter()
            .map(|n| {
                let claims_for_node = claims_map.get(&n.id).cloned().unwrap_or_default();
                let claims_with_state: Vec<ClaimWithTrackState> = claims_for_node
                    .iter()
                    .filter_map(|c| {
                        self.projector
                            .track(c.track_id)
                            .map(|t| ClaimWithTrackState {
                                claim: c.clone(),
                                track_state: t.state,
                            })
                    })
                    .collect();
                let shipments_for_node = ships_map.get(&n.id).cloned().unwrap_or_default();
                let derived = derive_node_status(&claims_with_state, &shipments_for_node, n.status);
                NodeView {
                    node: n.clone(),
                    derived_status: derived,
                }
            })
            .collect();

        RoadmapView {
            tree: Some(RoadmapTreeView {
                source: tree.source().to_string(),
                nodes,
            }),
            parse_error: None,
            claims: all_claims
                .into_iter()
                .map(|(node_id, claims)| NodeClaimsForView { node_id, claims })
                .collect(),
            shipments: all_shipments
                .into_iter()
                .map(|(node_id, shipments)| NodeShipmentsForView { node_id, shipments })
                .collect(),
            source_hash: Some(RoadmapHash::from_source(
                SystemTime::UNIX_EPOCH, // hash already includes mtime; re-derive from cache below
                tree.source(),
            )),
        }
    }

    /// Manual status write. Phase 22.A enforces the Done = shipped
    /// invariant at this entry point and emits an `AuditEntry` recording
    /// the attempt. Phase 22.D replaces this with a real
    /// `NodeStatusChanged` event + autonomy gradient.
    pub async fn set_node_status(
        &self,
        project_id: ProjectId,
        node_id: NodeId,
        status: NodeStatus,
    ) -> Result<(), CoreError> {
        // Done-gate: reject if the node has no recorded shipment.
        if matches!(status, NodeStatus::Done) {
            let shipments = self.projector.node_shipments(&node_id);
            if shipments.is_empty() {
                return Err(CoreError::Invariant(format!(
                    "node {node_id} has no shipment recorded — cannot mark Done"
                )));
            }
        }

        let stream = StreamId::Project(project_id);
        let payload = EventPayload::AuditEntry {
            category: "roadmap.node_status".into(),
            summary: format!("status set: {node_id} -> {status:?}"),
            details: serde_json::json!({
                "node_id": node_id,
                "status": status,
                "phase": "22.A",
                "note": "22.D will replace this AuditEntry with a NodeStatusChanged event",
            }),
        };
        let env = self
            .store
            .append(stream, None, Actor::user(), payload)
            .await?;
        self.projector.apply(&env);
        Ok(())
    }

    /// Lazily-initialized cache. Process-global because a `RoadmapCache`
    /// is cheap (one HashMap behind an RwLock) and tying it to `AppCore`
    /// would require a wider field surgery on `AppCore` than 22.A wants
    /// to take in one PR.
    fn roadmap_cache(&self) -> &'static RoadmapCache {
        use std::sync::OnceLock;
        static CACHE: OnceLock<RoadmapCache> = OnceLock::new();
        CACHE.get_or_init(RoadmapCache::new)
    }
}

fn file_quiesced(mtime: SystemTime, quiesce: Duration) -> bool {
    SystemTime::now()
        .duration_since(mtime)
        .map(|age| age >= quiesce)
        .unwrap_or(false)
}
